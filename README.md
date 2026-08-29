# OpenLooper

OpenLooper is a client-only, map-centric route-planning prototype for running, walking, and cycling. It is built to answer one question: is generating, comparing, inspecting, and editing local routes useful and enjoyable enough to keep developing?

> Experimental pre-production software. It is not a safety tool or a production navigation service.

The browser app uses OpenFreeMap globally and a local Valhalla instance for routes. The default routing graph covers Staffordshire and Derbyshire, including cross-county routes around Burton upon Trent and Swadlincote. The map can pan anywhere; a clear message appears when routing data is not loaded for the chosen area.

## What works

- Run, Walk, and Cycle A→B routing, including Valhalla alternatives for two-point routes.
- Draggable, removable, reversible waypoints and a routed waypoint-sketch mode.
- Activity-specific route preferences using claims Valhalla can actually represent.
- Twelve-seed, distance-targeted loop generation with bounded concurrency, one refinement pass, deduplication, quality ranking, and up to three choices.
- Distance, duration, approximate ascent/descent, interactive elevation profile, and GPX 1.1 export.
- Geographic route notes from normalized Valhalla attributes, with explicit uncertainty for absent OSM-derived data.
- Hover/tap inspection of attributed route segments, including normalized surface, road, infrastructure, grade, and recorded OSM-way details.
- Submit-only Nominatim search, opt-in browser location, and map-selected starts.
- Debounced restoration of the current map, plan, selected route, analysis, and loop alternatives after refresh.
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
npm run routing:prepare
npm run routing:up
npm run dev
```

Open the Vite URL printed by the final command. The first `routing:up` builds admins, time zones, elevation, and routing tiles and can take a while. Follow progress with:

```sh
npm run routing:logs
```

Confirm Valhalla is ready with `curl http://127.0.0.1:8002/status`. During development, Vite proxies `/api/valhalla/*` to that local service. Copy `.env.example` to `.env` only when overriding those defaults.

## Planning workflows

For A→B, select an activity, use **Set start** and **Set finish**, then tap the map. If Valhalla supplies alternatives they appear beneath the summary. Drag either marker or add an intermediate point; multipoint routes deliberately stop requesting alternatives.

For a loop, choose **Loop**, tap a start, set the target distance, and choose **Find loops**. OpenLooper tries rotated triangle and diamond shapes with at most four active requests, refines promising routes once, analyzes the best six, removes near-duplicates, and presents up to three. Local street-network shape may yield fewer. Selecting a loop promotes its shaping points into the editable plan.

For a sketch, choose **Sketch** and tap rough places to pass. The first two taps establish start/finish; later taps insert before the finish. This is waypoint sketching—Valhalla creates all final geometry.

Route notes can be selected to focus their exact map section. Unknown sidewalk or cycle-lane values are described as “not recorded,” never as proof that infrastructure is absent. GPX exports the selected route as a single ordered track segment.

Hover a route on desktop or tap it on touch devices to inspect the attributed edge beneath it. OpenLooper first asks Valhalla for an exact `edge_walk` trace; closed loops that Valhalla reports as ambiguous retry with its `walk_or_snap` fallback. Issue segments remain the higher-priority map interaction, while the explicit **Add point** tool takes priority over inspection.

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

The county extracts can emit administrative-boundary warnings because some wider England/UK relations are clipped from those regional files. `build_admins` remains enabled; these warnings do not prevent the verified local routing graph from serving routes.

## Search and data limitations

Search calls public Nominatim only after explicit submission, returns at most five results, rate-limits to one request per second, and caches identical in-session queries. There is no autocomplete. Search failure never blocks map selection. OpenFreeMap and Nominatim/OpenStreetMap attribution remain visible.

Routes obey Valhalla costing and its loaded graph. Notes reflect normalized graph attributes and may be incomplete or inherited from importer defaults. OpenLooper does not claim current traffic, quietness, personal safety, lighting, construction, pavement condition, accessibility, nearby-but-separate facilities, raw access-tag provenance, or temporary hazards. Elevation and grade are approximate. Always apply local knowledge.

This repository has no backend, database, authentication, sharing, tracking, analytics, production deployment, or compatibility framework. See [SPEC.md](SPEC.md) for the approved prototype scope.
