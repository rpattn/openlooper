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

No region data lives in any image. The merged PBF is 71 MB today and the
evidence database 345 MB, and both change on a completely different cadence
from the code — they belong on the node, not in a layer pushed on every commit.

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
```

That is roughly 900 MB. Do **not** copy `docker/evidence/data/sources/` — the
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

Two things worth knowing:

- **HTTPS is load-bearing.** The browser geolocation API refuses to run outside
  a secure context, so "use my location" silently does nothing over plain HTTP
  anywhere but localhost. The tunnel's TLS is what makes it work.
- **Put Cloudflare Access in front of it.** Neither service has any
  authentication, and loop generation fans a wave of requests at Valhalla per
  click. A public URL is an open compute endpoint on your home network. A
  one-rule Access policy on your own email is a couple of minutes' work.

Cloudflare's origin timeout is 100 s; the proxy is configured to give up at 95 s
so a slow route surfaces as a 504 from your own nginx rather than a 524 from the
edge.

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

## Widening the region

The area OpenLooper covers is entirely determined by
`/srv/openlooper/valhalla/local-region.osm.pbf`. Everything else — the routing
graph and the evidence database — is derived from that one file, and the
evidence service refuses to start unless its recorded `osm_pbf_sha256` matches
the PBF actually mounted. **The graph and the database always move together.**

### How far you can go

Evidence preparation projects to EPSG:27700, the British National Grid. That is
a hard boundary, not a preference: it degrades quickly outside Great Britain and
is meaningless in Ireland. Within GB, the limits are memory and time.

| Region | Merged PBF | vs. today |
| --- | --- | --- |
| Staffordshire + Derbyshire (the prototype) | 71 MB | 1× |
| The contiguous ring in `k8s/50-region-config.yaml` — adds Cheshire, Shropshire, West Midlands, Warwickshire, Worcestershire, Leicestershire, Nottinghamshire | ~250 MB | 3.5× |
| That plus South Yorkshire and Greater Manchester | ~364 MB | 5× |

The ring is the recommended target for a 32 GB node. It covers the Peak
District, Cannock Chase, the Shropshire Hills, Charnwood and Sherwood — the
terrain that makes the evidence layer interesting — while staying comfortably
inside memory.

What scales, and how:

- **Preparation memory.** The parent process holds an STRtree over every
  highway way in the region plus a per-section evidence dict, and eight forked
  workers dirty the shared geometry pages as they touch refcounts. The Job
  requests 8 Gi and caps at 24 Gi. This is the constraint that decides how far
  you can go.
- **Preparation time.** The two-county build took 45 minutes. The 21 GB
  archive's single-core decompression is a fixed floor that a bigger region does
  not change, but the byte prefilter works on whole-degree lat/lon bands, so a
  wider region rejects far fewer members before parsing them. Currently 831,443
  of 848,059 members are rejected on bytes alone; widen the bands and that ratio
  falls sharply. Budget 3–5 hours for the ring.
- **Database size.** 345 MB for 1.08 M stored sections, so the ring lands
  somewhere near 1.2 GB. The service memory-maps it read-only and queries
  through an R-tree, so serving cost barely moves.
- **Viewport limit does not move.** The service still refuses viewports over
  5,000 evidence sections. A wider region does not change the zoom at which that
  bites, because it depends on local density, not extent.
- **Valhalla graph build.** Rebuilding tiles for a 250 MB PBF is hours and needs
  several GB. The Deployment's startup probe allows two hours before the kubelet
  intervenes; watch the logs rather than the probe.

### Runbook

1. Edit the county list and apply it:

   ```bash
   kubectl apply -f k8s/50-region-config.yaml
   ```

2. Download and merge the extracts. This replaces `local-region.osm.pbf`, which
   immediately makes the running evidence service stale — it will keep serving
   from the database it already has open until it restarts, which is what you
   want until the new one is ready.

   ```bash
   kubectl -n openlooper delete job openlooper-region-prepare --ignore-not-found
   kubectl -n openlooper apply -f k8s/51-region-prepare-job.yaml
   kubectl -n openlooper logs -f job/openlooper-region-prepare
   ```

3. Rebuild the routing graph. The scripted image rebuilds when it finds no
   tiles, so remove them and restart:

   ```bash
   sudo rm -rf /srv/openlooper/valhalla/valhalla_tiles \
               /srv/openlooper/valhalla/valhalla_tiles.tar \
               /srv/openlooper/valhalla/valhalla.json
   kubectl -n openlooper rollout restart deploy/openlooper-valhalla
   kubectl -n openlooper logs -f deploy/openlooper-valhalla
   ```

   Elevation tiles under `elevation_data/` are worth keeping — the new ones
   download alongside them. Routing is down for the duration of this step.

4. Rebuild the evidence database. This is the long one, and the first run also
   downloads the 21 GB archive to `/srv/openlooper/gps` (resumable, and kept for
   later rebuilds — check you have the space):

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

   Keep `.previous` until you have confirmed `/api/evidence/status` answers and
   the map overlay draws, then delete it.

The same widening works locally without the cluster:

```bash
OPENLOOPER_REGION_URLS="\
https://download.geofabrik.de/europe/united-kingdom/england/staffordshire-latest.osm.pbf \
https://download.geofabrik.de/europe/united-kingdom/england/derbyshire-latest.osm.pbf \
https://download.geofabrik.de/europe/united-kingdom/england/cheshire-latest.osm.pbf" \
  npm run routing:prepare
```

`scripts/prepare-routing-data.sh` now names its downloads after the Geofabrik
file (`staffordshire-latest.osm.pbf`), where it previously used
`staffordshire.osm.pbf`. Old files under `docker/valhalla/data/sources/` are
just unused and can be deleted.

## When something is wrong

| Symptom | Cause |
| --- | --- |
| `openlooper-evidence` crash-loops with "Evidence database is stale" | The PBF and database disagree. Expected mid-region-change; finish the runbook. |
| `openlooper-evidence` crash-loops on "must both be mounted read-only" | `/srv/openlooper/evidence/route-use-evidence.sqlite` or the PBF is missing. |
| `/api/*` returns 502, the page loads | The upstream Deployment is not ready. This is the designed failure: routing degrades, the page does not. |
| The web pod fails with `host not found in upstream` | `DNS_RESOLVER` is wrong. Check `kubectl -n kube-system get svc kube-dns`. |
| Loop generation returns 504 | A wave of Valhalla requests exceeded 95 s. Usually a cold graph; retry once it is warm. |
| Cloudflare returns 524 | Something took longer than the edge's 100 s, upstream of nginx's own limit. |
| Evidence overlay silently empty at low zoom | The 5,000-section viewport limit. Working as designed; zoom in. |
| "Use my location" does nothing | Not a secure context. Reach the app through the tunnel hostname, not the node IP. |
