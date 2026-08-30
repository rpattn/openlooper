
  # OpenLooper Web Prototype Implementation Plan

  ## 1. Summary and success criteria

  Build a single-repository, client-only React application that opens directly onto a full-screen map and supports:

  - Run, Walk, and Cycle activity profiles.
  - A→B routing with optional waypoints and alternatives where Valhalla supports them.
  - Waypoint-based sketching and route editing.
  - Distance-targeted automatic loop generation with three useful candidates.
  - Distance, duration, elevation gain/loss, elevation profile, and GPX export.
  - Geographic route-quality warnings derived from Valhalla’s normalized OSM attributes.
  - Browser location, map-selected locations, and deliberately limited location search.
  - Local restoration of the current planning session.

  The prototype is successful when the three workflows in the goal can be completed comfortably at mobile and desktop widths and
  used to plan a real local route.

  No backend application, database, authentication, production deployment, CI, or automated tests will be introduced.

  ## 2. Recommended stack

  - React with TypeScript and Vite, using the official React plugin.
      - This is a client-heavy interactive utility; SSR and full-stack framework machinery provide no useful prototype benefit.
      - Vite has first-party React integration, fast local development, a simple static build, and an easy development proxy. Vite
        transpiles rather than type-checks, so tsc --noEmit will be a separate required command. Vite documentation, Vite TypeScript
        behavior

  - MapLibre GL JS directly, wrapped in one React map component rather than adding another React mapping framework.
      - Use the Vite-specific bundled worker URL recommended by MapLibre v6.
      - Render routes and issues through GeoJSON sources/layers; use draggable MapLibre markers for editable waypoints. MapLibre GL
        JS documentation, draggable markers

  - OpenFreeMap’s Liberty style initially, with its required attribution. No API key is required. OpenFreeMap quick start
  - Valhalla 3.8.3, pinned through the official ghcr.io/valhalla/valhalla-scripted image rather than latest. Valhalla 3.8.3 release,
    official Docker documentation

  - Plain React context plus useReducer for application state. Do not add Redux, Zustand, a query framework, or a persistence
    library.

  - Plain CSS with design tokens and responsive media/container queries. No component framework or CSS-in-JS dependency.
  - Lucide React for a restrained icon set.
  - A purpose-built responsive SVG elevation chart. Do not add a chart library for one simple profile.
  - Small local geospatial helpers for distance, bearing, interpolation, and loop waypoint generation. Avoid Turf unless
    implementation shows the geometry code becoming materially error-prone.

  - ESLint with TypeScript and React rules, used for useful static checks only.

  Runtime dependencies should initially be limited to React, React DOM, MapLibre GL JS, and Lucide React. Versions will be locked in
  the package lockfile.

  Package scripts:

  - dev: start Vite.
  - build: type-check, then create the Vite build.
  - typecheck: tsc --noEmit.
  - lint: read-only ESLint.
  - check: type-check, lint, and build.
  - routing:prepare, routing:up, routing:down, and routing:logs: thin commands around the documented local Docker workflow.
  - There will be no test script or testing dependencies.

  ## 3. Repository structure

  /
  ├── src/
  │   ├── app/
  │   │   ├── App.tsx
  │   │   ├── state.ts
  │   │   ├── persistence.ts
  │   │   └── routing-controller.ts
  │   ├── domain/
  │   │   ├── models.ts
  │   │   ├── activity-profiles.ts
  │   │   ├── geometry.ts
  │   │   ├── loops.ts
  │   │   ├── route-scoring.ts
  │   │   ├── route-analysis.ts
  │   │   ├── elevation.ts
  │   │   └── gpx.ts
  │   ├── routing/
  │   │   ├── valhalla-client.ts
  │   │   ├── valhalla-types.ts
  │   │   └── valhalla-mapper.ts
  │   ├── map/
  │   │   ├── RouteMap.tsx
  │   │   ├── map-layers.ts
  │   │   └── map-interactions.ts
  │   ├── ui/
  │   │   ├── PlannerSheet.tsx
  │   │   ├── ActivitySelector.tsx
  │   │   ├── RouteSummary.tsx
  │   │   ├── ElevationProfile.tsx
  │   │   ├── IssueList.tsx
  │   │   └── LocationSearch.tsx
  │   ├── styles/
  │   └── main.tsx
  ├── docker/
  │   └── valhalla/
  │       ├── compose.yaml
  │       └── data/.gitkeep
  ├── scripts/
  │   └── prepare-routing-data.sh
  ├── public/
  ├── .env.example
  ├── .gitignore
  ├── CODEX.md
  ├── README.md
  ├── package.json
  ├── tsconfig.json
  ├── eslint.config.js
  └── vite.config.ts

  The grouping is by behavior, not by speculative architectural layers. Files should be combined when they remain small.

  ## 4. Valhalla local-development architecture

  ### Default routing data

  - The default graph will cover Staffordshire and Derbyshire so Burton upon Trent and Swadlincote work across their county
    boundary.

  - Map rendering remains global. No geographic bounds or region checks will be embedded in the application.
  - Routing availability is determined solely by the graph loaded into the current Valhalla instance. Out-of-graph requests produce
    a clear “routing data is not loaded for this area” message while leaving the map usable.

  - Download the current Geofabrik Staffordshire and Derbyshire PBF extracts, currently approximately 29 MB and 42 MB respectively.
    Geofabrik England extracts

  - Merge them into one PBF before building. Valhalla currently discourages feeding multiple PBFs directly and recommends osmium
    merge. Valhalla issue and recommendation

  - Run a pinned Osmium Tool container from the preparation script so developers do not need a host Osmium installation. Downloaded
    PBFs, the merged PBF, elevation data, graph tiles, and generated Valhalla configuration all live beneath docker/valhalla/data/
    and are gitignored.

  ### Container and graph workflow

  1. npm run routing:prepare:
      - Download both extracts with resumable downloads.
      - Skip unchanged valid files.
      - Merge them into local-region.osm.pbf.
      - Print source URLs, file sizes, and modification dates.

  2. npm run routing:up:
      - Start the official scripted Valhalla container on port 8002.
      - Mount the data directory at /custom_files.
      - Enable build_elevation, build_admins, build_time_zones, and build_tar.
      - On first start, build the graph and download the elevation tiles covering the graph; subsequent starts reuse them.

  3. Vite proxies /api/valhalla/* to http://127.0.0.1:8002/*, avoiding browser CORS configuration during normal development.
  4. The routing client POSTs JSON to /route, /trace_attributes, and /status.
  5. README troubleshooting will cover first-build duration, disk use, logs, rebuilding after replacing the PBF, and confirming /
     status.

  Replacing local-region.osm.pbf with another single merged or regional PBF and rebuilding is the entire region-switching process.
  No region manager will be built.

  ## 5. Core application and domain model

  Use serializable application-owned types rather than MapLibre or raw Valhalla types:

  - Coordinate: { lat, lon }.
  - Activity: run | walk | cycle.
  - CreationMode: pointToPoint | loop | sketch.
  - Waypoint: stable ID, coordinate, and role (start | via | destination | generated).
  - RoutingPreferences:
      - Run/Walk: path-and-pavement preference, step avoidance, hill preference.
      - Cycle: road-comfort preference, paved-surface preference, hill preference.

  - RoutePlan: creation mode, activity, ordered waypoints, preferences, optional target loop distance.
  - RouteResult: decoded geometry, legs, distance, duration, sampled elevation, bounds, issues, and display metadata.
  - RouteAlternative: result plus candidate ID and loop-quality metrics.
  - RouteEdge: shape index range and normalized edge attributes.
  - RouteIssue: category, severity, evidence confidence, user-facing explanation, shape range, geometry, and length.
  - ElevationPoint: cumulative distance, elevation, and corresponding route coordinate.
  - PlannerState: map camera, plan, selected route, alternatives, loading/error state, highlighted edge/issue/profile point, and
    sheet state.

  Raw Valhalla request/response structures stay inside src/routing. Mapping into domain types happens once.

  Activity mappings:

  - Run: Valhalla pedestrian, default speed 10 km/h.
  - Walk: Valhalla pedestrian, default speed 5.1 km/h.
  - Cycle: Valhalla bicycle, default hybrid type and 18 km/h.
  - All route requests use kilometres and request elevation at 30 m intervals, matching Valhalla’s recommendation. Valhalla route
    API

  Preference mappings:

  - Run/Walk “Prefer paths & pavements” adjusts walkway_factor and sidewalk_factor.
  - Run/Walk “Avoid steps” applies a large step_penalty; the UI says “prefer to avoid,” never “guaranteed.”
  - Run/Walk hill choice maps to use_hills.
  - Cycle road-comfort choice maps to use_roads; this single control honestly combines quieter-road and cycle-infrastructure intent
    because Valhalla does not offer independent guarantees for both.

  - Cycle paved preference maps to bicycle_type plus avoid_bad_surfaces.
  - Cycle hill choice maps to use_hills.
  - Do not expose pedestrian “paved only,” “quiet roads,” or “avoid all major roads” controls because current pedestrian costing
    cannot represent those promises reliably. Bicycle costing options, pedestrian costing options

  ## 6. Map and route interaction model

  - Initialize at Burton upon Trent, but allow unrestricted global panning and zooming.
  - Full-viewport MapLibre map with OpenFreeMap tiles.
  - GeoJSON sources/layers:
      - inactive alternatives;
      - selected route casing and activity-coloured line;
      - route-edge interaction layer;
      - issue segments;
      - highlighted segment;
      - elevation cursor point.

  - Waypoints use large draggable markers with distinct start, via, and destination states.
  - Map clicks depend on the active tool:
      - Select-start tool sets or replaces the start.
      - A→B destination tool sets the destination.
      - Sketch mode appends waypoints.
      - Add-waypoint mode inserts into the nearest routed leg, determined by the closest route segment and its enclosing waypoint
        pair.

  - During marker drag, update the marker and provisional line visually; recalculate on drag end rather than flooding Valhalla.
  - Route-affecting buttons recalculate immediately.
  - Every async request uses AbortController and a monotonically increasing request ID so stale responses cannot replace newer
    edits.

  - Hover on desktop or tap on touch selects an attributed route edge and opens translated details.
  - Selecting an issue fits or eases the map to its segment and highlights it.
  - Reverse swaps waypoint order; loop routes retain start/end identity at the same coordinate.
  - Activity or preference changes reroute the current plan and clear stale analysis.

  ## 7. Route creation designs

  ### A→B

  - Send endpoints as break locations.
  - Send user-added intermediate points as through locations to influence the path without unnecessary leg arrival instructions or
    easy U-turns.

  - With exactly two points, request up to two Valhalla alternatives and show whatever number Valhalla returns.
  - Valhalla does not support alternatives on multipoint routes; once a waypoint is added, the UI stops promising alternatives and
    retains only the routed result. Valhalla alternatives limitation

  - Selecting an alternative promotes it to the editable current route.

  ### Draw/sketch

  - Use waypoint sketching, not freehand drawing, in this prototype.
  - First tap creates the start, second tap creates the destination and routes immediately, subsequent taps append before the
    destination.

  - Existing points remain draggable and removable.
  - “Add point” on an existing route inserts based on the nearest routed leg.
  - The interaction copy says “Tap places you roughly want to pass”; all geometry is created by Valhalla, never by connecting
    arbitrary straight lines as the final route.

  - Freehand input is explicitly deferred unless waypoint sketching proves inadequate during product use.

  ## 8. Automatic loop generation

  Implement a deterministic, understandable browser-side heuristic:

  1. Accept start, activity, and target distance.
  2. Generate twelve initial waypoint sets:
      - Eight rotated triangular loops.
      - Four rotated diamond loops.
      - Alternate clockwise and counter-clockwise waypoint order to expose one-way/network differences.

  3. Derive initial geometric radii from the target perimeter, then generate candidate coordinates with destination-point
     calculations.

  4. Submit candidates as start → generated through points → start, with at most four requests concurrently.
  5. Reject routing failures and candidates outside 30% of the target distance.
  6. For promising candidates, scale waypoint radius by targetDistance / actualDistance, clamped to a conservative adjustment range,
     then reroute once. Do not build an iterative optimizer.

  7. Decode candidate geometry and measure:
      - target-distance error;
      - repeated/out-and-back coverage;
      - compactness and extreme detours;
      - early return near the start;
      - route-to-route similarity.

  8. Run route attribution and issue analysis only for the best six geometric candidates.
  9. Add route-quality penalties and rank candidates.
  10. Deduplicate candidates sharing more than roughly 75% of their sampled geometry.
  11. Present the best three sufficiently distinct candidates. If fewer survive, show the available candidates and explain that
     local network shape limited generation.

  12. “Regenerate” rotates the seed bearings and shape mix rather than repeating identical requests.

  Candidate rejection defaults:

  - More than 30% distance error.
  - More than 35% repeated sampled coverage outside the first/last 100 m.
  - A major disconnected jump or invalid trace attribution.
  - Near-total duplication of a better candidate.

  These thresholds are prototype heuristics and should be kept as named constants beside the scoring code.

  ## 9. Route scoring

  Use an internal 0–100 score for ordering, not as a claim of objective route quality:

  - 45 points: closeness to requested distance.
  - 25 points: low repeated/out-and-back coverage.
  - 10 points: balanced loop geometry without extreme spikes or premature return.
  - 20 points: activity-specific issue burden, weighted by affected route length and severity.

  Activity-specific penalties include steps for all modes, poor cycle surfaces, major-road exposure, and unusually steep segments.
  Unknown data should never improve a score; it is neutral and surfaced separately.

  The UI should explain candidate differences using concrete labels such as “9.8 km,” “least repeated,” or “more unpaved sections,”
  rather than displaying the opaque numeric score.

  ## 10. Route attribution and issue detection

  After each selected route is received:

  1. Pass its encoded Valhalla shape to /trace_attributes using shape_match: "edge_walk", which is specifically intended for shapes
     returned by an earlier Valhalla route.

  2. Request only required fields: names, length, road class, shape indices, use, unpaved, surface, travel mode/type, grade/
     elevation, lane count, cycle lane, bicycle network, shoulder, sidewalk, way ID, and global OSM changeset.

  3. Convert edge shape-index ranges into geographic line segments.
  4. Merge adjacent edges with the same issue into concise runs.
  5. Render these runs as selectable map features and summarized issue groups. Valhalla trace attributes

  ### What can be shown

  Reliable normalized observations:

  - Dedicated footway, sidewalk, cycleway, road, track, ferry, or steps.
  - Valhalla’s normalized road class.
  - A recorded sidewalk or cycle-lane value.
  - Surface category and Valhalla’s unpaved flag.
  - Shoulder, lane count, bicycle-network membership, and way ID.
  - Maximum upward/downward grade and missing-elevation sentinel.
  - Which route geometry indices each attribute covers.

  Warnings derived directly from those observations:

  - Steps.
  - Trunk/primary/motorway-class exposure.
  - Valhalla-flagged unpaved or rough surface.
  - impassable surface if such an edge is ever returned.
  - A dedicated footway ending and the route continuing on a road edge.
  - Recorded steep segments, with the actual grade displayed.
  - Cycle routes using road edges without recorded cycle-lane data, phrased as missing recorded infrastructure rather than proof
    none exists.

  Likely suitability judgments:

  - Dirt, gravel, compacted, rough paved, or generic path surfaces may be unsuitable for the chosen activity/profile.
  - Major-road sections may be unpleasant for running, walking, or low-road-comfort cycling.
  - Grade thresholds may be unusually steep:
      - Run/Walk: flag sustained edge maxima above approximately 12%.
      - Cycle: flag above approximately 10%.

  - These are labelled “Potential issue” and show the evidence.

  Unknown-data notices:

  - A road edge without a sidewalk value becomes “Pavement/sidewalk not recorded,” not “No pavement.”
  - A road edge without cycle-lane attribution becomes “Cycle infrastructure not recorded.”
  - Missing elevation becomes “Gradient unavailable.”
  - Generic/default surface attribution becomes “Surface detail uncertain” where Valhalla does not expose provenance.

  ### What cannot be claimed reliably

  The prototype must explicitly avoid claiming:

  - That absent sidewalk data means there is no pavement.
  - That absent cycle-lane data means no separate or nearby cycle facility exists.
  - That a normalized surface value came from an explicit current OSM surface tag rather than Valhalla’s import/default rules.
  - Traffic volume, quietness, personal safety, lighting, construction state, pavement condition, or temporary hazards.
  - Segment-level explicit raw access restrictions from trace_attributes; the selected costing obeys Valhalla’s graph access rules,
    but the response does not expose enough provenance for a useful access warning.

  - Guaranteed accessibility or cycling suitability.
  - Per-segment OSM tagging completeness or freshness from the global changeset alone.

  Do not add Overpass calls to recover raw tags. That would introduce another rate-limited dependency and still would not turn
  incomplete tagging into certainty. A developer detail panel may show Valhalla attributes and link the recorded way_id to
  OpenStreetMap.

  ## 11. Elevation profile

  - Request Valhalla elevation in the normal route request with a 30 m interval. Valhalla returns an elevation array per leg when
    its graph was built with elevation. Valhalla elevation output

  - Combine leg profiles, remove duplicated leg-boundary samples, and associate each sample with cumulative distance.
  - Calculate displayed ascent/descent after a three-sample median filter and ignore sub-1-metre changes to reduce DEM noise. Label
    totals as approximate.

  - Render an accessible SVG area/line chart with distance ticks, elevation range, and a touch-sized scrub target.
  - Hovering or dragging across the graph interpolates the matching coordinate from the route’s cumulative-distance index and shows
    a marker on the map.

  - Tapping pins the cursor for mobile use; tapping again clears it.
  - If elevation is unavailable, keep the route usable and show a concise explanation rather than an empty graph.

  ## 12. Local persistence and GPX

  ### Persistence

  Use one localStorage key containing:

  - Last map centre and zoom.
  - Selected activity and preferences.
  - Current route plan.
  - Current selected route result, including geometry/elevation/issues, so refresh remains useful even if Valhalla is temporarily
    stopped.

  - Current loop alternatives when their payload remains comfortably within localStorage limits.

  Behavior:

  - Debounce writes.
  - Validate parsed object shape with small handwritten guards.
  - If parsing fails or the stored shape is obsolete, discard it and start cleanly.
  - No migration/version-compatibility framework: a single format number may be used only to identify and replace incompatible
    prototype state.

  - Do not persist browser location permission results.
  - Do not implement recent-route history initially.

  ### GPX

  - Generate GPX 1.1 in a pure TypeScript domain function.
  - Export the selected route as one <trk>/<trkseg> with ordered <trkpt> coordinates and interpolated <ele> where elevation exists.
  - Include route name, activity, distance, and generation timestamp metadata.
  - Download through a Blob URL in a small browser adapter.
  - No route sharing, imports, cloud storage, or turn-by-turn extensions.

  ## 13. Starting-position and search behavior

  - Browser location is opt-in through a prominent “Locate me” control.
  - Permission denial or unavailable geolocation leaves map selection fully usable.
  - Any map point can be selected as start.
  - Add location search through the public Nominatim endpoint only as a consciously limited prototype convenience:
      - Search only on explicit form submission; no autocomplete.
      - Maximum five results.
      - At most one request per second.
      - Cache recent identical queries locally.
      - Bias results toward the visible map without hard geographic restriction.
      - Display required attribution.
      - Keep the endpoint in one constant/environment value so it can be disabled or replaced.

  - These restrictions follow the public Nominatim policy, which permits moderate user-triggered searches but forbids client-side
    autocomplete. Nominatim usage policy, search API

  - Search failure never blocks map-based planning.

  ## 14. Mobile-first UI composition

  - Full-viewport map with no homepage, header bar, or conventional navigation.
  - Top floating controls:
      - Compact activity selector.
      - Search/start-location control.

  - Right-side map controls:
      - Locate.
      - Recenter/fit route.
      - Zoom on desktop where useful.

  - Bottom mobile sheet:
      - Collapsed: activity, route distance/duration, and primary action.
      - Half: creation-mode controls, preferences, alternatives, and summary.
      - Full: elevation, issues, and segment details.

  - Desktop:
      - The same planner content becomes a maximum-380-pixel floating surface at the left.
      - Route summary/elevation may occupy a compact bottom surface.
      - This is responsive composition, not a separate desktop sidebar product.

  - Creation modes use a clear segmented control: A→B, Loop, Sketch.
  - Minimum 44–48 px touch targets, visible focus states, keyboard-operable controls, safe-area padding, restrained borders/shadows,
    large rounded surfaces, and one activity accent colour at a time.

  - Avoid decorative animation. Use only short transitions for sheet and selection state.
  - Keep the route visually stronger than issue overlays, alternatives, and UI surfaces.

  ## 15. Expo/React Native migration posture

  - Domain types, activity profiles, geometry, loop generation, scoring, analysis, elevation processing, and GPX generation remain
    pure TypeScript without DOM or MapLibre imports.

  - Raw Valhalla mapping remains isolated, so a future mobile client can reproduce the same request/result contracts.
  - Persisted state is application-owned rather than React-component or MapLibre state.
  - RouteMap, browser geolocation, localStorage, Blob download, and Nominatim fetch presentation remain web-specific.
  - No shared package, monorepo, cross-platform component library, or generic routing-provider interface is introduced.
  - When Expo exists, copy or extract only the pure modules that have proved valuable.

  ## 16. Early technical proofs

  Prove these before significant UI polish:

  1. Official Valhalla 3.8.3 scripted image successfully builds a merged Staffordshire/Derbyshire graph with elevation on both amd64
     and arm64 hosts where available.

  2. A route crossing the Staffordshire/Derbyshire boundary works around Burton and Swadlincote.
  3. /route returns usable 30 m elevation and /trace_attributes can edge_walk the returned shape.
  4. Shape indices from attribution align exactly enough to colour individual issue segments.
  5. Sidewalk, surface, steps, road class, and cycle-lane values in this local OSM area are sufficiently populated to make the issue
     feature useful.

  6. Twelve loop requests plus refinement complete at an acceptable local latency without overwhelming Valhalla.
  7. MapLibre’s v6 Vite worker configuration works in both development and production build output.
  8. Current-route persistence remains well below typical localStorage limits.
  9. Public Nominatim accepts the deliberately submit-only browser interaction and attribution.

  If route attribution is too sparse locally, retain only defensible observations and make “unknown coverage” prominent; do not
  compensate with invented confidence.

  ## 17. Vertical implementation milestones

  ### Milestone 1 — Runnable map and A→B routing

  User-visible result:

  - App opens directly on a global OpenFreeMap map.
  - User selects Run, Walk, or Cycle, chooses start/destination by map or browser location, and sees an A→B route with distance and
    duration.

  - Two-point alternatives appear when Valhalla supplies them.

  Major work:

  - Repository setup, CODEX.md, initial README, strict TypeScript, lint/build scripts.
  - Local merged-region preparation and Valhalla Compose setup.
  - Map shell, core domain types, activity profiles, routing client/mapper, loading and error states.
  - Vite proxy and MapLibre worker configuration.

  Dependencies:

  - React, Vite, MapLibre, OpenFreeMap, Lucide, Docker, Valhalla, Geofabrik data.

  Uncertainties to prove:

  - Cross-county graph connectivity, container architecture support, elevation build, alternative response shape, out-of-coverage
    errors.

  Manual verification:

  - Run npm run routing:prepare, start Valhalla, and confirm status.
  - Run npm run dev; route Run, Walk, and Cycle between real points around Burton and across to Swadlincote.
  - Pan globally and confirm the map remains available outside routing coverage.
  - Deny location permission and plan successfully by clicking the map.
  - Request a route outside the graph and confirm a clear non-destructive error.
  - Run npm run check.

  ### Milestone 2 — Editable sketching and route inspection

  User-visible result:

  - User can sketch through waypoints, add/move/remove/reverse points, change activity/preferences, inspect summary and elevation,
    and scrub between elevation and map.

  - Route recalculation feels predictable.

  Major work:

  - Creation-mode state machine, draggable markers, waypoint insertion/removal/reversal.
  - Abort/stale-response handling.
  - Run/Walk/Cycle preference controls with honest labels.
  - Elevation processing, gain/loss, SVG profile, map cursor synchronization.
  - Basic segment selection plumbing.

  Dependencies:

  - Milestone 1 routing and stable decoded geometry.

  Uncertainties to prove:

  - Drag interaction on touch, elevation-to-geometry alignment across multiple legs, suitable reroute timing.

  Manual verification:

  - Complete the Cycle A→B workflow with two moved/added waypoints and GPX-ready geometry.
  - Complete the Walk sketch workflow with at least four points.
  - Rapidly drag a waypoint and change activity; confirm stale routes never replace the latest one.
  - Reverse routes and verify waypoint order, geometry, distance, and elevation update.
  - Scrub the elevation chart with mouse and narrow touch emulation.
  - Run npm run check.

  ### Milestone 3 — Useful automatic loops

  User-visible result:

  - User selects a start and target such as Run 10 km, receives up to three distinct loops, compares them, selects one, regenerates,
    and edits the chosen route.

  Major work:

  - Candidate waypoint geometry, bounded parallel routing, one-pass radius correction.
  - Geometry repetition, compactness, distance scoring, deduplication, and alternative UI.
  - Progress/cancellation states and graceful partial results.

  Dependencies:

  - Stable multipoint routing, editing, activity profiles, and route measurement.

  Uncertainties to prove:

  - Candidate success rate and latency on urban/rural networks around the default region.
  - Whether triangle/diamond diversity is enough to answer the product question.

  Manual verification:

  - Generate 5 km, 10 km, and 20 km loops from urban and edge-of-town starts for each activity.
  - Check candidate distances, distinctness, lack of obvious out-and-back behavior, and response time.
  - Select, edit, reverse, and regenerate loops.
  - Change preferences and verify candidates genuinely change where the network permits.
  - Stop/regenerate during generation and confirm obsolete responses are ignored.
  - Run npm run check.

  ### Milestone 4 — Route quality and segment inspection

  User-visible result:

  - Route issue segments are visible geographically and summarized concisely.
  - Selecting an issue focuses it on the map.
  - Route segments translate normalized attributes into understandable descriptions and explicitly show uncertainty.

  Major work:

  - /trace_attributes request/filter and edge mapping.
  - Confidence-aware issue rules, contiguous-run merging, summary prioritization, and map layers.
  - Candidate issue scoring for shortlisted loops.
  - Developer details with normalized attributes and OSM way links.

  Dependencies:

  - Accurate route-shape decoding and Valhalla graph elevation/OSM attribution.

  Uncertainties to prove:

  - Attribute completeness, edge-shape alignment, performance for longer routes, usefulness of warnings in the local area.

  Manual verification:

  - Deliberately route through known steps, paths, unpaved ways, primary roads, steep roads, and cycleways where local data permits.
  - Confirm each issue highlights the correct geometry.
  - Confirm absent sidewalk/cycle-lane values say “not recorded,” never “none.”
  - Inspect unknown elevation and sparse-tag cases.
  - Compare loop ordering before/after issue penalties for plausibility.
  - Run npm run check.

  ### Milestone 5 — Prototype closure

  User-visible result:

  - Current work survives refresh.
  - Location search, GPX export, narrow-screen sheets, polished controls, and practical documentation complete the real planning
    workflow.

  Major work:

  - Local persistence and invalid-state recovery.
  - Submit-only Nominatim search.
  - GPX generation/download.
  - Responsive sheet states, accessibility pass, visual consistency, status/error messaging.
  - Final README and explicit limitation documentation.

  Dependencies:

  - Stable application state and route-result model.

  Uncertainties to prove:

  - localStorage payload size, GPX compatibility with common route viewers/devices, mobile viewport ergonomics.

  Manual verification:

  - Execute every workflow in the goal from a clean browser session.
  - Refresh after selecting and editing a route with Valhalla running, then with Valhalla stopped.
  - Export GPX for each activity and open it in an independent GPX viewer.
  - Exercise submitted search without autocomplete and confirm map selection remains available when search fails.
  - Manually inspect at phone portrait, phone landscape, tablet, and desktop widths.
  - Verify keyboard focus, screen-reader labels, touch targets, attribution, loading, empty, and error states.
  - Run npm run check.

  No milestone creates automated tests, fixtures, test configuration, test scripts, or CI jobs.

  ## 18. Supported route-use evidence

  Route-use evidence is a supported product layer backed by the immutable, preparation-generated SQLite database. It is Boolean:
  all sources have equal effect, absent evidence remains unknown, and neither presence nor absence establishes popularity or safety.
  The generic `evidence_source` and `section_evidence` records remain the extension point for future preparation work; the runtime
  does not introduce a speculative storage abstraction.

  The local service preserves `/status`, `/evidence/sections`, and `/route-evidence`. Viewport lookup uses one joined query for
  geometry and provenance and rejects more than 5,000 sections with `viewport_too_broad`, leaving the existing client overlay in
  place. Route lookup batches way IDs, groups edges by OSM way, and performs Shapely 2 array operations. Six reusable workers retain
  immutable SQLite connections, and a thread-safe 128 MB LRU retains decoded/projected sections and prepared 2.5 m buffers.

  `/route-evidence` accepts additive `includeSegments`, defaulting to `true`; summary mode omits GeoJSON. `/route-evidence/batch`
  accepts at most six identified routes, loads their union of sections once, and returns one result per identifier. Loop ranking uses
  this summary batch. Selected-route segment geometry loads lazily only when its overlay is requested and must not trigger routing or
  ranking. The normal route summary and concise evidence/source controls appear in every build; scoring sliders and raw diagnostics
  remain development-only.

  The normal mild evidence bonus remains enabled. Unavailable evidence is neutral, and any high-severity route receives no bonus.
  Each service request records total, SQL, geometry, and serialization timings without retaining route coordinates. Manual acceptance
  requires warmed p95 below 250 ms for 5–30 km single summary/segment requests and viewports up to 5,000 sections, below 750 ms for a
  six-route summary batch, and RSS below 512 MB at six-request concurrency. If optimized Python misses a route target, replace only
  this runtime with an API-compatible Axum/Tokio service using rusqlite, GEOS, PROJ, and Serde; preparation remains Python.

  SQLite remains appropriate for the current single-instance, immutable, RTree-indexed workload. PostGIS is reconsidered only for
  independently updated datasets, concurrent writers, multi-region remote hosting, or replicated services. PostgreSQL and graph
  databases are outside this iteration because Valhalla owns graph traversal and evidence lookup starts with known way IDs.

  ## 19. Explicit deferred/non-goals

  Do not build:

  - Automated tests of any kind, fixtures, test infrastructure, or CI test jobs.
  - Authentication, profiles, accounts, social functionality, sharing, or cloud storage.
  - Backend application, database, server persistence, or public API.
  - Microservices, a separate routing engine repository, custom graph, OSM parser, or pathfinding engine. Rust is reserved solely for
    the evidence-runtime fallback described above if the Python performance gate fails.
  - CI/CD, deployment configuration, Kubernetes, Terraform, monitoring, telemetry, or analytics.
  - API versioning, backward-compatibility layers, feature flags, plugins, or generalized provider abstractions.
  - Native mobile code, monorepo/shared package, or web/native shared UI.
  - Offline routing/maps, turn-by-turn navigation, activity tracking, GPX import, Strava, Apple Health, payments, or subscriptions.
  - Freehand drawing unless waypoint sketching proves inadequate.
  - Raw Overpass-based OSM tag enrichment.
  - General-purpose region management.
  - Guaranteed safety, pavement, surface, accessibility, quietness, or cycle-infrastructure claims unsupported by the data.

  ## 20. Proposed CODEX.md contents

  # CODEX.md

  > This is a pre-production experimental prototype.

  The sole purpose of this repository is to determine whether this route-planning
  product is enjoyable and useful enough to continue building.

  ## Non-negotiable prototype rules

  - NO AUTOMATED TESTS.
  - NO CI/CD.
  - NO PRODUCTION INFRASTRUCTURE.
  - NO API VERSIONING.
  - NO BACKWARDS-COMPATIBILITY WORK.
  - NO ARCHITECTURE FOR HYPOTHETICAL FUTURE REQUIREMENTS.
  - NO NEW SERVICES WITHOUT A CURRENT PROTOTYPE REQUIREMENT.

  Do not add unit, integration, end-to-end, snapshot, or placeholder tests.
  Do not add test fixtures, test infrastructure, test configuration, test scripts,
  CI test jobs, or testing dependencies. This remains true when fixing bugs.

  When fixing a bug: reproduce it manually, implement the simplest fix, run the
  build and typecheck, and manually verify the changed behavior.

  ## Completion standard

  Before considering work complete:

  1. Run the TypeScript typecheck.
  2. Run useful read-only linting.
  3. Build the application.
  4. Manually exercise the changed functionality.

  The prototype must compile and run. Manual verification is the validation
  strategy for this stage.

  ## Development philosophy

  - Breaking changes are expected.
  - Prefer deleting or replacing bad prototype code over preserving compatibility.
  - Implement the simplest solution that proves the product behavior.
  - Product functionality takes priority over polish and infrastructure.
  - Keep dependencies intentional and few.
  - Keep code readable and human-oriented.
  - Prefer a small number of obvious modules over elaborate architecture.
  - Do not prematurely abstract code for imagined reuse.
  - Comments explain non-obvious decisions and constraints, not syntax.
  - Keep MapLibre-specific behavior inside the web map portion.
  - Keep raw Valhalla structures inside the routing module.
  - Keep portable product logic free of DOM and MapLibre types where practical.
  - Do not introduce a backend, database, account system, or new service unless a
    current prototype behavior genuinely cannot be delivered without it.
  - Do not silently turn incomplete OSM data into confident route-quality claims.

  This file is created in Milestone 1 and is treated as repository-level implementation guidance.

  ## 21. Proposed README.md contents

  1. Project
      - What OpenLooper is.
      - The single product question the prototype is meant to answer.
      - Prominent experimental status and no-production disclaimer.

  2. Current prototype status
      - Checklist of A→B, sketch, loops, route analysis, persistence, and GPX as milestones land.

  3. Prerequisites
      - Supported current Node LTS, npm, Docker with Compose, modern WebGL browser, disk/RAM expectations.

  4. Quick start
      - Install dependencies.
      - Prepare default Staffordshire/Derbyshire routing data.
      - Start Valhalla.
      - Start Vite.
      - Open the application.

  5. Routing data
      - Why the default graph covers Burton and Swadlincote.
      - Geofabrik sources and OSM attribution.
      - Merge step and generated files.
      - First-build elevation/tile time.
      - How to replace the PBF and rebuild for another region.
      - Explicit statement that the map/app are global and only loaded Valhalla data limits routing.

  6. Commands
      - Development, check/build, and routing lifecycle commands.
      - No test command.

  7. How the browser communicates with Valhalla
      - Local port, Vite proxy, relevant environment value, status endpoint.

  8. Location search
      - Submit-only Nominatim behavior, policy restrictions, attribution, and how to disable/replace the endpoint.

  9. Manual validation
      - Typecheck, lint, build, and the three end-to-end manual workflows.
      - Explicit statement that the repository intentionally contains no automated tests.

  10. Major limitations
      - Local graph coverage.
      - OSM/Valhalla data uncertainty.
      - No guarantee of pavement, safety, surface suitability, quietness, or access.
      - Heuristic loop generation.
      - Approximate elevation/ascent.
      - Public geocoder availability.
      - No production deployment, accounts, sync, navigation, or mobile app.

  11. Data and software attribution
      - OpenStreetMap, OpenFreeMap, MapLibre, Valhalla, Geofabrik, and Nominatim.

  12. Prototype philosophy
      - Link to CODEX.md and restate that functionality and learning take priority over infrastructure and compatibility.
