# OpenLooper

OpenLooper is a client-only, map-centric route-planning prototype for running, walking, and cycling. It is built to answer one question: is generating, comparing, inspecting, and editing local routes useful and enjoyable enough to keep developing?

> Experimental pre-production software. It is not a safety tool or a production navigation service.

The browser app uses OpenFreeMap globally and a local Valhalla instance for routes. The default routing graph covers Staffordshire and Derbyshire, including cross-county routes around Burton upon Trent and Swadlincote. The map can pan anywhere; a clear message appears when routing data is not loaded for the chosen area.

## What works

- Run, Walk, and Cycle A→B routing, including Valhalla alternatives for two-point routes.
- Draggable, removable, reversible waypoints and a routed waypoint-sketch mode.
- Activity-specific route preferences using claims Valhalla can actually represent: one route-character control, a surface tolerance, hills, and a separate list of things to avoid.
- Twelve-seed, distance-targeted loop generation seeded from a measured distance contour, with per-phase concurrency, one refinement pass, deduplication, quality ranking, and up to three choices.
- Activity-specific ranking with a route-character term built from recorded rights of way, greenspace, water, cycle networks and mode-classified GPS traces — the only part of the score a route can gain rather than only lose.
- Generated loop shaping points are treated as approximate areas: Valhalla may use a natural route edge within 150 m rather than creating a spur merely to touch an arbitrary coordinate. User-selected waypoints remain exact.
- Distance, duration, approximate ascent/descent, interactive elevation profile, and GPX 1.1 export.
- Geographic route notes from normalized Valhalla attributes, with explicit uncertainty for absent OSM-derived data.
- Click/tap inspection of attributed route segments, including normalized surface, road, infrastructure, grade, and recorded OSM-way details.
- Submit-only Nominatim search, opt-in browser location, and map-selected starts.
- Debounced restoration of the current map, plan, selected route, analysis, and loop alternatives after refresh.
- Supported binary route-use evidence summaries and map overlays, prepared offline from current OSM route relations, rights of way, greenspace and the mode-classified 2013 OSM GPS archive.
- One responsive map/sheet interface for phone, tablet, and desktop widths.
- Named routes saved on the device, listed with a drawn route card and reopened for viewing or editing. This is in the Expo client only; see `apps/openlooper-native/README.md`.

## Requirements

- Node.js 20 or newer and npm.
- Docker with Compose v2.
- A modern WebGL-capable browser and enough Docker memory for a regional Valhalla graph build.
- Roughly several GB of free disk space for source extracts, elevation, and generated graph files. Actual use varies with upstream data and container output.
- Internet access for initial packages, map tiles, search, PBF downloads, container images, and elevation tiles.

## Run it

```sh
npm install
npm run region:prepare
npm run routing:up
npm run evidence:up
npm run dev
```

Open the Vite URL printed by the final command. The first `routing:up` builds admins, time zones, elevation, and routing tiles and can take a while. Follow progress with:

```sh
npm run routing:logs
```

Confirm Valhalla is ready with `curl http://127.0.0.1:8002/status`. During development, Vite proxies `/api/valhalla/*` to that local service. Copy `.env.example` to `.env` only when overriding those defaults.

`region:prepare` first prepares routing data, then downloads and processes the official approximately 21 GB compressed 2013 OSM GPS archive. It does not start either service. Routing still works when the evidence service is unavailable; the route summary reports that state and evidence remains neutral.

### Expo native/web client

`apps/openlooper-native` is a universal Expo SDK 57 client that shares this repository's domain, routing, and scoring code. Run it from the repository root:

```sh
npm run native
npm run native:web
npm run native:check
```

It talks to the same local Valhalla and evidence services. On web the Expo dev server proxies `/api/valhalla/*` and `/api/evidence/*` exactly as Vite does; on device it derives the service host from the Metro bundle URL. See [`apps/openlooper-native/README.md`](apps/openlooper-native/README.md) for service configuration and for building an iOS development build.

## Planning workflows

For A→B, select an activity, use **Set start** and **Set finish**, then tap the map. If Valhalla supplies alternatives they appear beneath the summary. Drag either marker or add an intermediate point; multipoint routes deliberately stop requesting alternatives.

For a loop, choose **Loop**, tap a start, set the target distance, and choose **Find loops**. OpenLooper first asks Valhalla how far the network actually reaches in every direction and places the shaping points on that contour rather than on a circle, then tries 12 rotated triangle and diamond shapes in one wave, scores each candidate once, reuses candidates already within 3% of the target, and refines the strongest remaining routes once with at most eight active requests (capped at eight candidates above 10 km and six above 20 km). It analyzes the best six, removes near-duplicates, and presents up to three. Local street-network shape may yield fewer. Selecting a loop promotes its shaping points into the editable plan.

For a sketch, choose **Sketch** and tap rough places to pass. Each tap extends the provisional endpoint. Once there are two distinct points, tap the current endpoint to finish an open A→B route or tap the start marker to close and finish a loop. Completed sketches use the normal add, drag, remove, and reverse editing tools. This is waypoint sketching—Valhalla creates all final geometry.

Route notes can be selected to focus their exact map section. Notes that record an absence — unknown pavement, cycle lane, gradient or surface detail — are collapsed into one summary line beneath the real findings; they score nothing and burying the findings under them helped nobody. Unknown sidewalk or cycle-lane values are described as “not recorded,” never as proof that infrastructure is absent. GPX exports the selected route as a single ordered track segment.

Click or tap a route to inspect the attributed edge beneath it; hovering changes only the pointer. A background click closes an open edge detail without editing the route. OpenLooper asks Valhalla for an exact `edge_walk` trace on open routes and goes straight to its `walk_or_snap` fallback on closed ones, which Valhalla rejects as ambiguous; an open route that still comes back ambiguous retries with the fallback. Issue segments remain the higher-priority map interaction, while the explicit **Add point** tool takes priority over inspection.

## Validation commands

```sh
npm run typecheck
npm run lint
npm run build
npm run check
```

There are intentionally no automated tests, test dependencies, test script, or fixtures. Manual browser verification is the prototype validation strategy. The one workflow under `.github/workflows/` publishes container images; it runs no checks.

## Routing-data maintenance

`routing:prepare` downloads the current Staffordshire and Derbyshire Geofabrik extracts, validates non-empty existing downloads, and merges them with pinned Osmium 1.18 images for amd64 (`iboates/osmium`) or arm64 (`mvherweg/gis-arm64-osmium`). It prints every source URL, size, and modification date. Source PBFs, merged data, elevation, graph tiles, and generated config remain under `docker/valhalla/data/` and are ignored by Git.

To refresh data, remove the two source PBFs under `docker/valhalla/data/sources/` and `local-region.osm.pbf`, run `routing:prepare`, stop Valhalla, remove its generated graph/config artifacts in the data directory, then run `routing:up`. These removals are intentional local maintenance and are not automated by the project. To switch or widen the region, set `OPENLOOPER_REGION_URLS` to a space- or newline-separated list of Geofabrik extract URLs and rebuild; Geofabrik splits England by county, so widening means naming more counties. Evidence preparation projects to EPSG:27700, so the region has to stay inside Great Britain. [docs/deployment.md](docs/deployment.md) records what a wider region costs to prepare.

Use `npm run routing:down` to stop the service. If startup stalls, inspect `routing:logs`, check Docker disk allocation, verify the merged PBF is non-empty, and remember elevation downloading requires network access. Both amd64 and arm64 depend on the published architecture support of the pinned images.

## Route-use evidence

The evidence layer asks only whether a short section of the current routing network has credible evidence of use. It does not calculate popularity, frequency, recency, activity, unique users, or negative evidence. **No route-use evidence means unknown, not unused, unsafe or unsuitable.**

Preparation uses the exact `local-region.osm.pbf` used by Valhalla, divides current `highway=*` ways into deterministic 25 m sections, marks accepted current OSM route relations, rights of way, lighting, speed limits and proximity to recorded greenspace and water, then streams GPX members directly from the compressed 2013 archive. GPX timestamps are used to derive a speed and classify each coordinate as foot, cycle, vehicle or unclassified, so route-use evidence records *which mode* was recorded rather than only that something passed. Only evidenced sections enter the SQLite output. Raw regional coordinates, timestamps, contributor metadata, track structure, ordering, and journeys are never retained. A build takes about 40 minutes and prints progress every 30 seconds.

The runtime service refuses to start unless the mounted PBF SHA-256 matches the database build metadata. Check it with `curl http://127.0.0.1:8003/status`; use `npm run evidence:logs` and `npm run evidence:down` for its lifecycle. Missing or stale evidence never blocks routing and gives no ranking bonus.

The route summary reports the evidenced percentage in every build. The **Route-use evidence** control can show all viewport evidence or one human-labelled source — grouped by whether it records use, a designation, or the way's surroundings — and overlay evidenced/unknown portions of the selected route. Loop ranking requests summaries for the six shortlisted routes in one batch; segment GeoJSON is loaded only when a selected-route overlay is requested, so enabling an overlay never reroutes or reranks candidates.

Ranking weights differ by activity, and the character term is worth 20–30 points depending on it. Sources are weighted by what they claim rather than counted equally: a recorded public footpath counts for more than being beside a wood, vehicle-speed GPS counts against a running route, and the undifferentiated `gps_unclassified_2013` class is excluded from ranking entirely because it tracks the road network rather than route quality. Unavailable or missing evidence stays neutral — a route with no breakdown gets no character term rather than a zero. Blocking problems scale the term down with the distance they affect instead of switching it off, so twenty metres of steps no longer wipes it out. Raw scoring controls and diagnostics remain development-only.

The service accepts at most six routes per batch, rejects viewports exceeding 5,000 sections without replacing the current map overlay, uses six bounded workers, and keeps decoded/projected section geometry in a 128 MB cache. Adding rights of way and greenspace roughly doubles the stored sections, so that viewport limit is reached at a lower zoom than before. See the evidence documentation for request shapes and operational limits.

See [Route-use evidence preparation and validation](docs/route-use-evidence.md) for archive origin, licensing, matching rules, endpoints, resource requirements, and the manual validation checklist.

The county extracts can emit administrative-boundary warnings because some wider England/UK relations are clipped from those regional files. `build_admins` remains enabled; these warnings do not prevent the verified local routing graph from serving routes.

## Search and data limitations

Search calls public Nominatim only after explicit submission, returns at most five results, rate-limits to one request per second, and caches identical in-session queries. There is no autocomplete. Search failure never blocks map selection. OpenFreeMap and Nominatim/OpenStreetMap attribution remain visible.

Routes obey Valhalla costing and its loaded graph. Notes reflect normalized graph attributes and may be incomplete or inherited from importer defaults. OpenLooper does not claim current traffic, quietness, personal safety, lighting, construction, pavement condition, accessibility, nearby-but-separate facilities, raw access-tag provenance, or temporary hazards. Elevation and grade are approximate. Always apply local knowledge.

This repository has no backend, authentication, sharing, tracking, analytics, or compatibility framework. See [SPEC.md](SPEC.md) for the approved prototype scope.

## Deploying it

The prototype can run on a single-node k3s homelab behind a Cloudflare tunnel, with the Expo web export, Valhalla, and the evidence service published on one hostname and per-client rate limits on the API paths. Region data stays on the node rather than in any image, and the node can rebuild a wider region itself. Routing and evidence cover separate areas there: routing tiles are memory-mapped and scale, while evidence preparation is bounded by RAM, so the deployed evidence region is a sub-region cut out of the routing one. See [Deploying OpenLooper to a single-node k3s homelab](docs/deployment.md); manifests are in `k8s/`.

This is still personal-testing deployment, not production operation: there is no authentication in front of either service, no backups, and no availability guarantee.
