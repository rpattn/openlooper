# Deploying OpenLooper to a single-node k3s homelab

This is a prototype deployment: one node, one namespace, data on the node's
filesystem, and manifests applied by hand over SSH. There is no GitOps, no
autoscaling, and no high availability, and none of that is missing by accident.

## Shape of it

```
Cloudflare edge ──tunnel──▶ cloudflared ──▶ openlooper-web (nginx :8080)
                                                 │  /                 static Expo web export
                                                 ├─ /api/valhalla/* ─▶ openlooper-valhalla :8002
                                                 └─ /api/evidence/* ─▶ openlooper-evidence  :8003
```

Everything is published on **one hostname**. That is not a stylistic choice:
neither Valhalla nor the evidence service answers CORS preflight requests, so a
browser calling them from a different origin fails before the request is made.
The nginx in `openlooper-web` splits one origin back into three services, which
is exactly what the Vite and Metro dev servers already do locally.

Two images are built from this repository and pushed to Docker Hub:

| Image | Built from | Contents |
| --- | --- | --- |
| `rpattn/openlooper-web` | `docker/web/Dockerfile`, context = repo root | `expo export --platform web` output plus the nginx proxy |
| `rpattn/openlooper-evidence` | `docker/evidence/Dockerfile` | the evidence service and its preparation script |

Valhalla is **not** built here. It runs the upstream
`ghcr.io/valhalla/valhalla-scripted:3.8.3` image and takes its region from the
graph prepared on the node.

No region data lives in any image. The routing PBF and the evidence database
change on a completely different cadence from the code, and a GB-wide graph runs
to several GB — they belong on the node, not in a layer pushed on every commit.

## One-time node setup

Create the data directories:

```bash
sudo mkdir -p /srv/openlooper/{valhalla,evidence,gps}
```

Seed them from the machine where you already prepared the prototype region, so
the cluster has something to serve before you attempt a wider rebuild:

```bash
rsync -av --info=progress2 docker/valhalla/data/ NODE:/srv/openlooper/valhalla/
rsync -av --info=progress2 \
  docker/evidence/data/route-use-evidence.sqlite \
  docker/evidence/data/build-report.json \
  NODE:/srv/openlooper/evidence/
# The evidence service checks its database against the PBF sitting beside it,
# not against the routing one — see "Choosing the region". For this first seed
# they are the same file.
rsync -av --info=progress2 docker/valhalla/data/local-region.osm.pbf \
  NODE:/srv/openlooper/evidence/evidence-region.osm.pbf
```

That is roughly 1 GB. Do **not** copy `docker/evidence/data/sources/` — the
21 GB GPS archive is only needed to rebuild evidence, and the prepare Job
downloads it onto the node itself.

Then apply the manifests:

```bash
kubectl apply -f k8s/00-namespace.yaml
kubectl apply -f k8s/10-valhalla.yaml -f k8s/20-evidence.yaml -f k8s/30-web.yaml
```

Confirm all three are up before touching Cloudflare:

```bash
kubectl -n openlooper get pods
kubectl -n openlooper port-forward svc/openlooper-web 8080:80
# then, from your workstation:
curl -s localhost:8080/healthz
curl -s localhost:8080/api/valhalla/status
curl -s localhost:8080/api/evidence/status | head -c 400
```

`openlooper-web` becomes ready immediately even when the other two are still
starting — nginx resolves both upstreams per request rather than at boot, so a
cold cluster gives you 502s on `/api/*` and a working page, not a crash loop.

## Cloudflare tunnel

If you already run cloudflared, skip `k8s/40-cloudflared.yaml` and add a public
hostname to that tunnel pointing at
`http://openlooper-web.openlooper.svc.cluster.local:80` (in-cluster) or at a
NodePort you expose. Otherwise:

1. Zero Trust → Networks → Tunnels → create a tunnel, copy the connector token.
2. `kubectl -n openlooper create secret generic cloudflared-token --from-literal=token='<token>'`
3. `kubectl apply -f k8s/40-cloudflared.yaml`
4. Add a public hostname routing to `http://openlooper-web.openlooper.svc.cluster.local:80`.

**HTTPS is load-bearing.** The browser geolocation API refuses to run outside a
secure context, so "use my location" silently does nothing over plain HTTP
anywhere but localhost. The tunnel's TLS is what makes it work.

Cloudflare's origin timeout is 100 s; the proxy is configured to give up at 95 s
so a slow route surfaces as a 504 from your own nginx rather than a 524 from the
edge.

## Keeping the API from being someone else's compute

A tunnel hostname is a public URL. It will be found — Cloudflare issues a
certificate, certificate transparency logs are public, and scanners read them.
What a stranger finds is a routing engine and a geometry service with no
authentication in front of them, on your home network, reachable by anyone who
can construct a POST.

That is worth bounding, but it does not have to mean logging in. `openlooper-web`
enforces per-client limits itself, in `docker/web/nginx.conf.template`:

| Setting | Default | What it does |
| --- | --- | --- |
| `API_RATE` | `15r/s` | Sustained requests per client to `/api/*` |
| `API_BURST` | `60` | Allowed instantly before the rate applies |
| `API_CONCURRENCY` | `32` | Simultaneous in-flight requests per client |

Static files are never limited, so the page always loads. Over the limit
returns 429.

The burst is the part that matters. One "Find loops" click is a contour
measurement, twelve seeds in one wave, then up to eight refinements — a rate
limit without a generous burst would throttle the feature the app exists for.
The rate bounds what anyone can sustain; `API_CONCURRENCY` is what actually
protects Valhalla, which serves on four threads.

The limits key on `CF-Connecting-IP`, falling back to `$remote_addr`. This is
not optional detail: behind the tunnel every request arrives from the
cloudflared pod, so `$remote_addr` is one address for the entire internet and
limiting on it would throttle all your clients as one. Tune without a rebuild:

```bash
kubectl -n openlooper set env deploy/openlooper-web API_RATE=10r/s API_BURST=40
```

Doing this in Cloudflare instead is also fine, and stacks — the free plan
includes a rate-limiting rule and the free managed WAF ruleset. Check your
plan's current allowance in the dashboard rather than trusting this paragraph.
The advantage of the nginx limits is that they live in this repository, apply
identically to a `port-forward`, and cost nothing to change.

What rate limiting does **not** do is stop anyone from using the app. If you
would rather it were yours alone, a Cloudflare Access policy on your own email
is a couple of minutes in the dashboard and free for personal use — and unlike a
rate limit it also means no stranger is reading your route history from a shared
device. For a prototype you are testing personally, a rate limit is a
defensible place to stop; keep an eye on `kubectl -n openlooper logs
deploy/openlooper-web`, which logs the real client IP and request time.

## Shipping a code change

Push to the `production` branch. `.github/workflows/publish.yml` builds both
images and pushes `latest` and a short-SHA tag to Docker Hub.

```bash
git push origin master:production
```

This repository currently has no remote configured — `git remote add origin …`
first. The workflow needs two repository secrets: `DOCKERHUB_USERNAME` and
`DOCKERHUB_TOKEN` (Docker Hub → Account settings → Personal access tokens).

Both Deployments use `imagePullPolicy: Always` on `:latest`, so rolling out is:

```bash
kubectl -n openlooper rollout restart deploy/openlooper-web deploy/openlooper-evidence
kubectl -n openlooper rollout status deploy/openlooper-web
```

To pin a specific build instead of tracking `latest`:

```bash
kubectl -n openlooper set image deploy/openlooper-web web=rpattn/openlooper-web:sha-abc1234
```

## Choosing the region

Two regions, not one. Valhalla and the evidence service have completely
different cost profiles, and treating them as one area is what makes a wide
deployment look impossible:

- **Routing tiles** are built once and then memory-mapped. The build is slow and
  the tiles are large, but serving costs almost nothing and scales fine.
- **Evidence preparation** holds an STRtree over every highway way in its region
  plus a per-section dict, in RAM, in one process. This is the wall.

So `/srv/openlooper/valhalla/local-region.osm.pbf` can cover far more ground
than `/srv/openlooper/evidence/evidence-region.osm.pbf`, which is cut out of it
by `osmium extract`. The evidence service only ever checks that the PBF mounted
beside its database is the one that database was built from — nothing requires
it to be the file Valhalla routes on. Cutting one from the other keeps both at
the same OSM vintage, so way IDs and geometry agree wherever they overlap.
Outside the evidence region there is simply no evidence, which is already what
the app means by unknown: routing works, the summary reports the state, and
ranking stays neutral.

Both are set in `k8s/50-region-config.yaml`.

### What it actually costs

Measured on the two-county prototype region, not estimated:

| | Value | Per byte of PBF |
| --- | --- | --- |
| Merged PBF | 71 MB | 1× |
| Highway ways | 277,004 | |
| Network sections | 1.71 M, of which 1.08 M evidenced | |
| Evidence database | 345 MB | 4.9× |
| Valhalla tiles + tar | 182 MB | 2.6× |
| Elevation (4 cells) | 99 MB | — grows with bounding box, not PBF size |
| Evidence preparation peak RSS | **2.04 GiB** | **29×** |
| Evidence preparation wall clock | 45 min | |

The 29× is the number that decides everything. It was measured by running
`prepare_evidence.py` with `--gps-member-limit 1`, which does the whole
network-building phase and skips the GPS matching pass, so the real full-build
peak is somewhat higher — the GPS pass adds an accumulator and eight forked
workers dirtying shared pages.

### Great Britain, on a 32 GB / 50 GB node

Use `europe/great-britain` (2.02 GB), not `europe/united-kingdom` (2.10 GB).
The difference is Northern Ireland, and evidence preparation projects to
EPSG:27700 — the British National Grid — which does not cover it.

**Routing: yes.** GB is 28.5× the prototype region, so roughly 5.3 GB of tiles
and about 2 GB of elevation. The tile build is the slow part — hours, and
`build_admins` on a GB extract is memory-hungry — but it happens once and
serving afterwards is memory-mapped.

**Evidence: no, and not close.** 2.04 GiB × 28.5 is about **58 GiB** for the
network phase alone, before the GPS pass. You are short by a factor of two to
three, and the resulting database would be near 10 GB. This is not a tuning
problem; it needs either a much larger machine or a change to
`prepare_evidence.py` to spill its per-section state to disk instead of holding
it in RAM.

So the answer to "the whole UK" on this box is: **route it all, evidence the
part you actually run in.** That is what the shipped config does — a GB routing
PBF and a Midlands evidence bbox.

The evidence ceiling here is about **500 MB of PBF**, and it is RAM, not disk:
a 24 GiB Job budget against a full-build cost of roughly 50× the PBF once the
GPS pass's accumulator and eight forked workers are added to the measured 29×.
Scaling `openlooper-valhalla` and `openlooper-evidence` to zero for the duration
frees a few more GB — both are unusable mid-region-change anyway — which buys
perhaps another 70 MB of region. Swap does not help: the matching phase is
millions of random STRtree lookups and would thrash. The default bbox
(`-3.15,52.05,-0.75,53.55`) covers Staffordshire, Derbyshire, Cheshire,
Shropshire, the West Midlands, Warwickshire, Worcestershire, Leicestershire and
Nottinghamshire. The prepare Job prints the extract's size and a projected peak
before handing over, so widen the bbox, run it, and read the number before
committing to a multi-hour build.

### Disk

500 GB is not a constraint here. The whole deployment, with a GB routing graph
and the GPS archive kept permanently resident, is under 50 GB:

| | |
| --- | --- |
| OS, k3s, container images | ~12 GB |
| GB routing PBF (plus the resumable source copy) | 4.0 GB |
| Valhalla tiles + tar | 5.3 GB |
| Elevation | ~2.0 GB |
| Evidence sub-region PBF | ~0.4 GB |
| Evidence database, keeping `.previous` and `.next` | ~6.0 GB |
| GPS archive | 21 GB |
| **Total** | **~51 GB of 500** |

Keep `/srv/openlooper/gps/gpx-planet-2013-04-09.tar.xz` rather than deleting it
between builds. The prepare Job re-downloads it resumably if it is missing, but
21 GB over the wire is hours you do not need to spend, and the md5 check in the
init container runs either way.

There is room to keep every `.previous` database you make, which is worth doing:
rolling back a region change is then a `mv` and a restart rather than another
multi-hour build.

## Region-change runbook

1. Edit `k8s/50-region-config.yaml` and apply it:

   ```bash
   kubectl apply -f k8s/50-region-config.yaml
   ```

2. Download the routing extract and cut the evidence sub-region out of it. This
   replaces both PBFs, which immediately makes the running evidence service
   stale — it keeps serving the database it already has open until it restarts,
   which is what you want until the new one is ready.

   ```bash
   kubectl -n openlooper delete job openlooper-region-prepare --ignore-not-found
   kubectl -n openlooper apply -f k8s/51-region-prepare-job.yaml
   kubectl -n openlooper logs -f job/openlooper-region-prepare
   ```

   Read the projected preparation peak it prints before going further.

3. Rebuild the routing graph. The scripted image rebuilds when it finds no
   tiles, so remove them and restart:

   ```bash
   sudo rm -rf /srv/openlooper/valhalla/valhalla_tiles \
               /srv/openlooper/valhalla/valhalla_tiles.tar \
               /srv/openlooper/valhalla/valhalla.json
   kubectl -n openlooper rollout restart deploy/openlooper-valhalla
   kubectl -n openlooper logs -f deploy/openlooper-valhalla
   ```

   Keep `elevation_data/` — new cells download alongside the existing ones.
   Routing is down for the duration, which for a GB build is hours.

4.    Rebuild the evidence database. The first run also downloads the 21 GB archive
   to `/srv/openlooper/gps` and verifies its md5; leave it there afterwards so
   later rebuilds skip that:

   ```bash
   kubectl -n openlooper delete job openlooper-evidence-prepare --ignore-not-found
   kubectl -n openlooper apply -f k8s/52-evidence-prepare-job.yaml
   kubectl -n openlooper logs -f job/openlooper-evidence-prepare
   ```

   It writes `route-use-evidence.sqlite.next`, leaving the live database alone.

5. Promote it. Stop the service first: replacing a bind-mounted file under a
   running pod leaves that pod holding the old inode.

   ```bash
   kubectl -n openlooper scale deploy/openlooper-evidence --replicas=0
   cd /srv/openlooper/evidence
   sudo mv route-use-evidence.sqlite route-use-evidence.sqlite.previous
   sudo mv route-use-evidence.sqlite.next route-use-evidence.sqlite
   sudo mv build-report.json.next build-report.json
   kubectl -n openlooper scale deploy/openlooper-evidence --replicas=1
   kubectl -n openlooper logs -f deploy/openlooper-evidence
   ```

   Keep `.previous`. There is disk for it, and it turns a bad region change back
   into a `mv` and a restart instead of another multi-hour build.

Locally, without the cluster, `scripts/prepare-routing-data.sh` takes
`OPENLOOPER_REGION_URLS` as a space- or newline-separated list of Geofabrik URLs
and merges them. It now names downloads after the Geofabrik file
(`staffordshire-latest.osm.pbf`) where it previously used
`staffordshire.osm.pbf`; old files under `docker/valhalla/data/sources/` are
unused and can be deleted. The local compose setup does not split routing from
evidence — that split exists only in the cluster manifests.

## When something is wrong

| Symptom | Cause |
| --- | --- |
| `openlooper-evidence` crash-loops with "Evidence database is stale" | The PBF and database disagree. Expected mid-region-change; finish the runbook. |
| `openlooper-evidence` crash-loops on "must both be mounted read-only" | `route-use-evidence.sqlite` or `evidence-region.osm.pbf` is missing from `/srv/openlooper/evidence`. |
| `/api/*` returns 429 | The per-client rate limit. Raise `API_RATE`/`API_BURST` on `openlooper-web`, or find out who is hitting it in that pod's logs. |
| `/api/*` returns 502, the page loads | The upstream Deployment is not ready. This is the designed failure: routing degrades, the page does not. |
| The web pod fails with `host not found in upstream` | `DNS_RESOLVER` is wrong. Check `kubectl -n kube-system get svc kube-dns`. |
| Loop generation returns 504 | A wave of Valhalla requests exceeded 95 s. Usually a cold graph; retry once it is warm. |
| Cloudflare returns 524 | Something took longer than the edge's 100 s, upstream of nginx's own limit. |
| Evidence overlay silently empty at low zoom | The 5,000-section viewport limit. Working as designed; zoom in. |
| "Use my location" does nothing | Not a secure context. Reach the app through the tunnel hostname, not the node IP. |
