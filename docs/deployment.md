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

## Two ways in

Create the data directories either way:

```bash
sudo mkdir -p /srv/openlooper/{valhalla,evidence,gps}
```

**On a distribution with SELinux enforcing** — Fedora, RHEL, CentOS, openSUSE —
label them so containers may write to them. Without this every Job fails on its
first write with `Permission denied` even as root, because the pod is refused by
policy rather than by file permissions:

```bash
getenforce   # if this says Enforcing, do the next two
sudo semanage fcontext -a -t container_file_t "/srv/openlooper(/.*)?"
sudo restorecon -Rv /srv/openlooper
```

`semanage` comes from `policycoreutils-python-utils`. Doing it this way survives
a filesystem relabel, and files created underneath inherit the type, which
`chcon -Rt container_file_t /srv/openlooper` alone would not.

The alternative — `seLinuxOptions` with `spc_t` in the pod spec — would let these
containers reach far more of the host than their own data, so relabel the
directories instead.

Then pick one:

- **Build the region on the node.** The right choice for anything wider than the
  two-county prototype, and the only choice if the node has more RAM than your
  workstation. See *First deployment, from nothing* below.
- **Seed the prototype region from a workstation that already has it.** Fastest
  way to get something serving, and a reasonable first step before committing a
  day to a UK-wide build:

  ```bash
  rsync -av --info=progress2 docker/valhalla/data/ NODE:/srv/openlooper/valhalla/
  rsync -av --info=progress2 \
    docker/evidence/data/route-use-evidence.sqlite \
    docker/evidence/data/build-report.json \
    NODE:/srv/openlooper/evidence/
  # The evidence service checks its database against the PBF beside it, not
  # against the routing one. For this seed they happen to be the same file.
  rsync -av --info=progress2 docker/valhalla/data/local-region.osm.pbf \
    NODE:/srv/openlooper/evidence/evidence-region.osm.pbf
  ```

  About 1 GB. Do **not** copy `docker/evidence/data/sources/` — the 21 GB GPS
  archive is only needed to rebuild evidence, and the node fetches it itself.
  Then apply everything and skip to the checks below:

  ```bash
  kubectl apply -f k8s/00-namespace.yaml
  kubectl apply -f k8s/10-valhalla.yaml -f k8s/20-evidence.yaml -f k8s/30-web.yaml
  ```

### Checking it

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

## First deployment, from nothing

For a node with no prepared data at all. Everything is derived on the node; do
not seed it from a workstation. Total elapsed time is most of a day, nearly all
of it two builds you start and walk away from.

**Run the two builds one after the other, never at the same time.** Valhalla's
tile build and the evidence preparation Job are each allowed 24 Gi on a 32 GB
node, and overlapping them will OOM-kill one of them hours in.

```bash
sudo mkdir -p /srv/openlooper/{valhalla,evidence,gps}
git -C ~/openlooper pull
```

The evidence Jobs run `rpattn/openlooper-evidence`, so that image has to exist
on Docker Hub first — push `production` and let the workflow finish before
step 4.

Widen in one direction only. The evidence region is cut from the routing PBF,
so building UK-wide routing first means widening evidence later is a config
change and one Job — no second Valhalla build. Doing it the other way round
throws the long build away. So: UK routing from the start, evidence starting at
the Midlands, and step 4 repeated with a wider bbox when you want more.

1. **Namespace and region.** Check `k8s/50-region-config.yaml` first: it ships
   with UK-wide routing and a Midlands evidence bbox at a 2x2 grid.

   ```bash
   kubectl apply -f k8s/00-namespace.yaml -f k8s/50-region-config.yaml
   ```

2. **Region prepare** — downloads the 2.1 GB extract and cuts the evidence
   sub-region out of it. Tens of minutes, mostly transfer.

   ```bash
   kubectl -n openlooper apply -f k8s/51-region-prepare-job.yaml
   kubectl -n openlooper logs -f job/openlooper-region-prepare
   ```

   It prints both PBF sizes and a projected evidence preparation peak. If that
   projection is near 24 GiB, narrow `evidence-bbox` and run it again before
   spending a day on a build that ends in an OOM kill.

3. **Routing graph** — the first long build. Hours, and it downloads about 2 GB
   of elevation along the way.

   ```bash
   kubectl apply -f k8s/10-valhalla.yaml
   kubectl -n openlooper logs -f deploy/openlooper-valhalla
   ```

   Wait for it to finish before starting step 4. Confirm with
   `kubectl -n openlooper get pods` showing `1/1 Running`.

   This is the step most likely to fail on 16 GB. If it is OOM-killed, set
   `routing-url` to `england` (1.58 GB) or empty it to merge the county list,
   then re-run step 2. Do not reach for swap — see below.

4. **Evidence database** — the second long build. Downloads and md5-checks the
   21 GB GPS archive, prefilters it once, cuts the region into tiles, builds
   each and merges them. Every step keeps its finished work, so a re-run
   resumes rather than restarting.

   ```bash
   kubectl -n openlooper create configmap openlooper-tile-script \
     --from-file=tile_region.sh=docker/evidence/tile_region.sh \
     --dry-run=client -o yaml | kubectl apply -f -
   kubectl -n openlooper apply -f k8s/52-evidence-prepare-job.yaml
   kubectl -n openlooper logs -f job/openlooper-evidence-prepare
   ```

   The ConfigMap carries `tile_region.sh` into the osmium step, which has no
   copy of this repository. Re-apply it whenever that script changes.

5. **Promote the database.** On a first install there is nothing to move aside,
   so this is just a rename — the `.previous` step in the region-change runbook
   below does not apply yet.

   ```bash
   cd /srv/openlooper/evidence
   sudo mv route-use-evidence.sqlite.next route-use-evidence.sqlite
   sudo mv build-report.json.next build-report.json
   kubectl apply -f k8s/20-evidence.yaml
   kubectl -n openlooper logs -f deploy/openlooper-evidence
   ```

6. **Serve it.**

   ```bash
   kubectl apply -f k8s/30-web.yaml
   kubectl -n openlooper port-forward svc/openlooper-web 8080:80
   ```

   Check `/healthz`, `/api/valhalla/status` and `/api/evidence/status` before
   attaching the tunnel.

### Doing it by hand instead

The Jobs are a convenience, not a requirement. Nothing in the cluster owns this
data: the Deployments mount `/srv/openlooper/valhalla` and
`/srv/openlooper/evidence` as plain `hostPath` directories, so anything that
puts the right files there works, and the Jobs are only wrappers around the
commands below. Build by hand if you would rather watch it directly.

Two things have to hold, whichever way you build:

- `route-use-evidence.sqlite` and `evidence-region.osm.pbf` must sit beside each
  other in `/srv/openlooper/evidence`, and the PBF must be the one the database
  was built from. The service hashes it at startup and refuses to run otherwise.
- Build on the node. A workstation with less RAM than the node cannot prepare a
  region the node can serve — preparation peaks at roughly 50× the evidence
  PBF's size.

A manual build also gets the whole machine rather than the Job's 24 Gi ceiling,
which buys a little more region.

```bash
# 1. Routing PBF. A single extract needs no merge — just download it.
sudo curl -fL --retry 5 -C - -o /srv/openlooper/valhalla/local-region.osm.pbf \
  https://download.geofabrik.de/europe/united-kingdom-latest.osm.pbf

# 2. Evidence sub-region, cut from that same file so both are one OSM vintage.
docker run --rm \
  -v /srv/openlooper/valhalla:/routing:ro \
  -v /srv/openlooper/evidence:/evidence \
  iboates/osmium:1.18.0 \
  extract --overwrite --bbox -3.15,52.05,-0.75,53.55 --strategy complete_ways \
    /routing/local-region.osm.pbf -o /evidence/evidence-region.osm.pbf

# 3. GPS archive, resumable, then verify it before spending hours on it.
sudo curl -fL --retry 5 -C - -o /srv/openlooper/gps/gpx-planet-2013-04-09.tar.xz \
  https://planet.openstreetmap.org/gps/gpx-planet-2013-04-09.tar.xz
curl -fL -o /tmp/gps.md5 \
  https://planet.openstreetmap.org/gps/gpx-planet-2013-04-09.tar.xz.md5
awk '{print $1}' /tmp/gps.md5
md5sum /srv/openlooper/gps/gpx-planet-2013-04-09.tar.xz

# 4. The long one. Build the image locally rather than pulling if you prefer:
#    docker build -t openlooper-evidence:local docker/evidence
docker run --rm --name openlooper-evidence-prepare \
  -v /srv/openlooper/evidence:/evidence \
  -v /srv/openlooper/gps:/gps:ro \
  rpattn/openlooper-evidence:latest \
  python /app/prepare_evidence.py \
    --pbf /evidence/evidence-region.osm.pbf \
    --gps-archive /gps/gpx-planet-2013-04-09.tar.xz \
    --output /evidence/route-use-evidence.sqlite \
    --report /evidence/build-report.json \
    --workers 8
```

Writing straight to `route-use-evidence.sqlite` is fine on a first build. Once
the service is live, write to `route-use-evidence.sqlite.next` and use the swap
in the region-change runbook instead — replacing the file under a running pod
leaves it serving the old inode.

The routing graph is the exception worth leaving to the cluster: the Valhalla
Deployment builds its own tiles when it finds none, so applying
`k8s/10-valhalla.yaml` and watching its logs is less work than driving
`valhalla_build_tiles` yourself.

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

The workflow needs one repository secret, `DOCKERHUB_TOKEN` — a Read & Write
access token from Docker Hub → Account settings → Personal access tokens. It has
to be a *repository* secret under Settings → Secrets and variables → Actions;
an environment secret or a variable resolves to empty and the run fails with
`Error: Password required`. The account name is not a secret and is set as
`DOCKERHUB_NAMESPACE` in the workflow, because it is already in the manifests
and keeping it secret masks every image name in the logs.

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

### The UK, on a 16 GB node

Use `europe/united-kingdom` (2.10 GB) for routing. Valhalla has no projection
constraint, so Northern Ireland routes fine; only the evidence region is bound
to Great Britain by EPSG:27700.

**Routing, serving: fine.** Tiles are memory-mapped, so a UK graph serves in
about the same memory as a county one.

**Routing, building: uncertain.** The tile build is a different workload from
serving, and 2.1 GB of PBF against a 12 Gi ceiling is not comfortable. If it
fails, fall back to `england` (1.58 GB) or a group of counties.

**Not by adding swap**, which earlier revisions of this document suggested. It
is bad advice on a Kubernetes node for two independent reasons. kubelet runs
with `failSwapOn: true` by default, so enabling swap risks it refusing to start
on the next restart and taking every other workload on the node with it. And it
would not help even then: a container is bounded by its cgroup `memory.max`,
which does not draw on host swap unless the NodeSwap feature and a `memory.swap.max`
are configured too. The cost of getting this wrong is the rest of the cluster;
the cost of a smaller routing region is some coverage.

**Evidence: no longer bounded by memory.** A single-process build peaks at
roughly 50x its PBF, which would be about 100 GiB UK-wide. The evidence region
is therefore built in tiles and merged, so peak memory is set by the largest
tile. Sixteen gigabytes constrains how *small* the tiles must be, not how large
the region can be.

### Building a region larger than memory

`prepare_evidence.py` holds an STRtree over every highway way, the geometries,
and a per-section dict in RAM at once. Rather than rewrite that, the region is
cut into tiles, each built normally, and the results merged.

This is exact, not approximate, and it rests on two properties:

- `section_id` is `way_id:section_index`, a deterministic 25 m offset along the
  way. It does not depend on what else was in the PBF.
- `osmium extract --strategy smart` keeps a way that crosses a tile boundary
  whole, so its length, section count and geometry are identical in every tile
  that contains it.

Two things are needed to make a tiled build match a whole-region one, and each
fails on its own:

- **Context.** A tile is extracted with a margin beyond the cell it owns. Without
  it, a coordinate near a cell edge is attributed to the wrong way, because the
  truly nearest way was cut away.
- **Ownership.** `--own-bbox` makes a tile write only the ways whose midpoint
  falls inside its cell. Without it, those wrong attributions survive in the
  union — and widening the margin makes that *worse*, not better, by enlarging
  the surface on which a truncated tile can guess.

The margin is not sized by the 24 m matching radius. Greenspace and water
proximity consult polygons that run to kilometres. Measured against a
whole-region build, a 0.002 degree margin still lost evidence up to 830 m from a
boundary; 0.05 degrees reproduced it exactly.

Verified rather than assumed. A region built in two tiles and merged, compared
against the same region built in one process:

| | |
| --- | --- |
| Sections | 165,406 in both, identical set |
| Evidence rows | 247,767 in both, identical set |
| Geometry | byte-identical |
| R-tree | complete, and a viewport query straddling the boundary returns rows |
| Service startup | passes its PBF checksum check against the merged database |

Ownership also partitions cleanly: every way is owned by exactly one tile, so the
merge reported zero duplicate sections.

The GPS archive is prefiltered once. Every tile build streams it, and
decompressing 21 GB of xz is single-core — a floor of roughly forty minutes per
pass, which ten tiles would pay ten times. `prefilter_gps.py` inflates it once,
keeps the members whose bytes could hold a coordinate in the region, and writes
them uncompressed; the tile builds then read at disk speed. The intermediate is
a few GB for the shipped Midlands region and tens of GB for a UK-wide one, which
is what the 500 GB disk is for. The original archive's checksums are carried
into the database, so it still records what it was built from.

Choosing a grid: `tile-cols` and `tile-rows` in `k8s/50-region-config.yaml`. The
tiling step prints each tile's size and a projected peak before anything long
starts — raise the grid until the largest clears the Job's 12 Gi limit. Tiles
also resume: a completed tile is kept, so a failed run continues rather than
restarting.

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
| Prefiltered intermediate | a few GB regional, tens of GB UK-wide |
| Tile PBFs and per-tile databases | roughly twice the region's own |
| **Total** | **well under 150 GB of 500** |

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
   kubectl -n openlooper create configmap openlooper-tile-script \
     --from-file=tile_region.sh=docker/evidence/tile_region.sh \
     --dry-run=client -o yaml | kubectl apply -f -
   kubectl -n openlooper delete job openlooper-evidence-prepare --ignore-not-found
   kubectl -n openlooper apply -f k8s/52-evidence-prepare-job.yaml
   kubectl -n openlooper logs -f job/openlooper-evidence-prepare
   ```

   The ConfigMap carries `tile_region.sh` into the osmium step, which has no
   copy of this repository. Re-apply it whenever that script changes.

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
| A prepare Job shows `Init:Error` | The failure is in an init container, so plain `kubectl logs` will not show it. Name the container: `kubectl -n openlooper logs <pod> -c download`, or `--all-containers`. |
| `Permission denied` writing under `/routing`, `/evidence` or `/gps`, as root | SELinux. Check `getenforce`; a trailing `.` on `ls -ld` and `seclabel` in `findmnt` are the other tells. Relabel as in *Two ways in*. |
| `openlooper-evidence` crash-loops with "Evidence database is stale" | The PBF and database disagree. Expected mid-region-change; finish the runbook. |
| `openlooper-evidence` crash-loops on "must both be mounted read-only" | `route-use-evidence.sqlite` or `evidence-region.osm.pbf` is missing from `/srv/openlooper/evidence`. |
| `/api/*` returns 429 | The per-client rate limit. Raise `API_RATE`/`API_BURST` on `openlooper-web`, or find out who is hitting it in that pod's logs. |
| `/api/*` returns 502, the page loads | The upstream Deployment is not ready. This is the designed failure: routing degrades, the page does not. |
| The web pod fails with `host not found in upstream` | `DNS_RESOLVER` is wrong. Check `kubectl -n kube-system get svc kube-dns`. |
| Loop generation returns 504 | A wave of Valhalla requests exceeded 95 s. Usually a cold graph; retry once it is warm. |
| Cloudflare returns 524 | Something took longer than the edge's 100 s, upstream of nginx's own limit. |
| Evidence overlay silently empty at low zoom | The 5,000-section viewport limit. Working as designed; zoom in. |
| "Use my location" does nothing | Not a secure context. Reach the app through the tunnel hostname, not the node IP. |
