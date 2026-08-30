# OpenLooper

OpenLooper is a client-only, map-centric route-planning prototype for running, walking, and cycling. It is built to answer one question: is generating, comparing, inspecting, and editing local routes useful and enjoyable enough to keep developing?

> Experimental pre-production software. It is not a safety tool or a production navigation service.

The browser app uses OpenFreeMap globally and a local Valhalla instance for routes. The default routing graph covers Staffordshire and Derbyshire, including cross-county routes around Burton upon Trent and Swadlincote. The map can pan anywhere; a clear message appears when routing data is not loaded for the chosen area.

## What works

- Run, Walk, and Cycle A→B routing, including Valhalla alternatives for two-point routes.
- Draggable, removable, reversible waypoints and a routed waypoint-sketch mode.
- Activity-specific route preferences using claims Valhalla can actually represent.
- Twelve-seed, distance-targeted loop generation with bounded concurrency, one refinement pass, deduplication, quality ranking, and up to three choices.
- Generated loop shaping points are treated as approximate areas: Valhalla may use a natural route edge within 150 m rather than creating a spur merely to touch an arbitrary coordinate. User-selected waypoints remain exact.
- Distance, duration, approximate ascent/descent, interactive elevation profile, and GPX 1.1 export.
- Geographic route notes from normalized Valhalla attributes, with explicit uncertainty for absent OSM-derived data.
- Click/tap inspection of attributed route segments, including normalized surface, road, infrastructure, grade, and recorded OSM-way details.
- Submit-only Nominatim search, opt-in browser location, and map-selected starts.
- Debounced restoration of the current map, plan, selected route, analysis, and loop alternatives after refresh.
- Supported binary route-use evidence summaries and map overlays, prepared offline from current OSM route relations and the 2013 OSM GPS archive.
- One responsive map/sheet interface for phone, tablet, and desktop widths.

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

<<<<<<< HEAD
`region:prepare` first prepares routing data, then downloads and processes the official approximately 21 GB compressed 2013 OSM GPS archive. It does not start either service. Routing still works when the evidence service is unavailable; the route summary reports that state and evidence remains neutral.

### Expo native/web client

The frontend is also being translated into a universal Expo SDK 57 app under `apps/openlooper-native`. It currently ports the responsive planner shell, activity and creation-mode controls, waypoint/sketch state, native maps, and a Leaflet web map. Run it from the repository root with:

```sh
npm run native
npm run native:web
npm run native:check
```

The existing Vite app remains the complete reference implementation during migration. See [`apps/openlooper-native/README.md`](apps/openlooper-native/README.md) for the migration boundary and next slices.

`region:prepare` first prepares routing data, then downloads and processes the official approximately 21 GB compressed 2013 OSM GPS archive. It does not start either service. For ordinary work without the evidence experiment, the original `routing:prepare`, `routing:up`, `dev` flow still works and evidence remains neutral/unavailable.
>>>>>>> 96d9fce (add expo draft)

## Planning workflows

For A→B, select an activity, use **Set start** and **Set finish**, then tap the map. If Valhalla supplies alternatives they appear beneath the summary. Drag either marker or add an intermediate point; multipoint routes deliberately stop requesting alternatives.

For a loop, choose **Loop**, tap a start, set the target distance, and choose **Find loops**. OpenLooper tries 12 rotated triangle and diamond shapes with at most four active requests, reuses candidates already within 3% of the target, and refines the strongest remaining routes once (capped at eight above 10 km and six above 20 km). It analyzes the best six, removes near-duplicates, and presents up to three. Local street-network shape may yield fewer. Selecting a loop promotes its shaping points into the editable plan.

For a sketch, choose **Sketch** and tap rough places to pass. Each tap extends the provisional endpoint. Once there are two distinct points, tap the current endpoint to finish an open A→B route or tap the start marker to close and finish a loop. Completed sketches use the normal add, drag, remove, and reverse editing tools. This is waypoint sketching—Valhalla creates all final geometry.

Route notes can be selected to focus their exact map section. Unknown sidewalk or cycle-lane values are described as “not recorded,” never as proof that infrastructure is absent. GPX exports the selected route as a single ordered track segment.

Click or tap a route to inspect the attributed edge beneath it; hovering changes only the pointer. A background click closes an open edge detail without editing the route. OpenLooper first asks Valhalla for an exact `edge_walk` trace; closed loops that Valhalla reports as ambiguous retry with its `walk_or_snap` fallback. Issue segments remain the higher-priority map interaction, while the explicit **Add point** tool takes priority over inspection.

## Validation commands

```sh
npm run typecheck
npm run lint
npm run build
npm run check
```

There are intentionally no automated tests, test dependencies, test script, fixtures, or CI. Manual browser verification is the prototype validation strategy.

## Routing-data maintenance

`routing:prepare` downloads the current Staffordshire and Derbyshire Geofabrik extracts, validates non-empty existing downloads, and merges them with pinned Osmium 1.18 images for amd64 (`iboates/osmium`) or arm64 (`mvherweg/gis-arm64-osmium`). It prints every source URL, size, and modification date. Source PBFs, merged data, elevation, graph tiles, and generated config remain under `docker/valhalla/data/` and are ignored by Git.

To refresh data, remove the two source PBFs under `docker/valhalla/data/sources/` and `local-region.osm.pbf`, run `routing:prepare`, stop Valhalla, remove its generated graph/config artifacts in the data directory, then run `routing:up`. These removals are intentional local maintenance and are not automated by the project. To switch regions, provide one merged/regional PBF named `local-region.osm.pbf` and rebuild.

Use `npm run routing:down` to stop the service. If startup stalls, inspect `routing:logs`, check Docker disk allocation, verify the merged PBF is non-empty, and remember elevation downloading requires network access. Both amd64 and arm64 depend on the published architecture support of the pinned images.

## Route-use evidence

The evidence layer asks only whether a short section of the current routing network has credible evidence of use. It does not calculate popularity, frequency, recency, activity, unique users, or negative evidence. **No route-use evidence means unknown, not unused, unsafe or unsuitable.**

Preparation uses the exact `local-region.osm.pbf` used by Valhalla, divides current `highway=*` ways into deterministic 25 m sections, marks accepted current OSM route relations, then streams GPX members directly from the compressed 2013 archive. Only evidenced sections enter the SQLite output. Raw regional coordinates, timestamps, contributor metadata, track structure, ordering, and journeys are never retained.

The runtime service refuses to start unless the mounted PBF SHA-256 matches the database build metadata. Check it with `curl http://127.0.0.1:8003/status`; use `npm run evidence:logs` and `npm run evidence:down` for its lifecycle. Missing or stale evidence never blocks routing and gives no ranking bonus.

The route summary reports the evidenced percentage in every build. The **Route-use evidence** control can show all viewport evidence or one human-labelled source and overlay evidenced/unknown portions of the selected route. Loop ranking requests summaries for the six shortlisted routes in one batch; segment GeoJSON is loaded only when a selected-route overlay is requested, so enabling an overlay never reroutes or reranks candidates.

The normal ranking allocates up to 5 mild bonus points for evidence. All sources have equal Boolean effect, unavailable or missing evidence remains neutral, and a route with any high-severity issue receives no evidence bonus. Raw scoring controls and diagnostics remain development-only.

The service accepts at most six routes per batch, rejects viewports exceeding 5,000 sections without replacing the current map overlay, uses six bounded workers, and keeps decoded/projected section geometry in a 128 MB cache. See the evidence documentation for request shapes and operational limits.

See [Route-use evidence preparation and validation](docs/route-use-evidence.md) for archive origin, licensing, matching rules, endpoints, resource requirements, and the manual validation checklist.

The county extracts can emit administrative-boundary warnings because some wider England/UK relations are clipped from those regional files. `build_admins` remains enabled; these warnings do not prevent the verified local routing graph from serving routes.

## Search and data limitations

Search calls public Nominatim only after explicit submission, returns at most five results, rate-limits to one request per second, and caches identical in-session queries. There is no autocomplete. Search failure never blocks map selection. OpenFreeMap and Nominatim/OpenStreetMap attribution remain visible.

Routes obey Valhalla costing and its loaded graph. Notes reflect normalized graph attributes and may be incomplete or inherited from importer defaults. OpenLooper does not claim current traffic, quietness, personal safety, lighting, construction, pavement condition, accessibility, nearby-but-separate facilities, raw access-tag provenance, or temporary hazards. Elevation and grade are approximate. Always apply local knowledge.

This repository has no backend, database, authentication, sharing, tracking, analytics, production deployment, or compatibility framework. See [SPEC.md](SPEC.md) for the approved prototype scope.
