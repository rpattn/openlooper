# Route-use evidence preparation and validation

This is supported local product functionality, not a popularity or safety model.

> No route-use evidence means unknown, not unused, unsafe or unsuitable.

## Sources and licensing

The historical coordinate input is the official OpenStreetMap [`gpx-planet-2013-04-09.tar.xz`](https://planet.openstreetmap.org/gps/gpx-planet-2013-04-09.tar.xz), with its published [MD5 file](https://planet.openstreetmap.org/gps/gpx-planet-2013-04-09.tar.xz.md5). The [official GPS archive directory](https://planet.openstreetmap.org/gps/) describes the archive as approximately 21 GB compressed and labels the GPS material CC BY-SA 2.0. The smaller `simple-gps-points-120312.txt.xz` is from 2012 and is deliberately not used. Background is in the OSM [Planet.gpx documentation](https://wiki.openstreetmap.org/wiki/Planet.gpx).

Current network geometry and accepted `running`, `foot`, `hiking`, `bicycle`, and `mtb` [route relations](https://wiki.openstreetmap.org/wiki/Route) come from the exact regional PBF used by Valhalla and are attributed © OpenStreetMap contributors under ODbL 1.0. Only empty and `main` way-member roles are accepted; proposed relations are ignored.

The build stores both source summaries and provenance. This output is for local prototype use. Do not redistribute the source archive or derived database without a separate licensing review.

## Resources and commands

Allow roughly 21 GB for the retained compressed archive, several additional gigabytes for Docker/cache and temporary database work, 2–4 GB RAM, and potentially several hours for the planet-wide streaming pass. No complete uncompressed copy is created.

```sh
npm run region:prepare
npm run routing:up
npm run evidence:up
npm run dev
```

`region:prepare` is only a convenience sequence for `routing:prepare` and `evidence:prepare`; it starts no service. `evidence:prepare` resumes the archive download, retrieves the official MD5, verifies the complete compressed file, builds the pinned Python 3.12 image, and creates:

- `docker/evidence/data/route-use-evidence.sqlite`
- `docker/evidence/data/build-report.json`
- retained compressed input under the ignored `docker/evidence/data/sources/`

The report contains aggregates only: archive checksums and duration; parsed/in-region/accepted coordinates; distance, ambiguity, and vertical-structure rejection totals; network/evidenced section counts and lengths; union coverage percentage; and database size.

For an archive-streaming spike without a runtime-valid database, run the preparation container directly with `--gps-member-limit N`. Limited builds are marked incomplete and the service refuses them.

## Association rules

The builder projects current linear `highway=*` geometries to EPSG:27700 and divides every way into consecutive 25 m sections. IDs are build-local and deterministic: `way_id:section_index`. The final section may be shorter. Replacing the PBF requires a complete rebuild; there is no identity migration.

Each GPX coordinate is handled independently:

1. Reject coordinates outside the current network bounds plus 50 m.
2. Find nearby current OSM ways in a spatial index.
3. Accept the nearest only within 18 m.
4. Reject when another way is within 6 m of the winner's distance.
5. Classify a close competing way with different `bridge`, `tunnel`, or `layer` tags as a vertical-structure conflict.
6. Project an accepted point onto the winning way and mark its 25 m section.

One coordinate is enough; duplicates do not add strength. Route relations mark every section of an accepted member way. One optional relation ID is retained per section/source, but overlapping relations and multiple sources never add weight.

## SQLite and HTTP behavior

The database contains metadata, source descriptions, evidenced `network_section` rows, unique `(section_id, source_id)` records, indexes by way/source, and an RTree for viewport lookup. Each `network_section.geometry_wkb` is the unsimplified WGS84 `LineString` produced by transforming the exact projected 25 m substring boundaries (with only a shorter final section). Stored section geometry is never buffered, simplified, unioned, or replaced with route-overlap geometry. Metre offsets and matching use EPSG:27700.

The private read-only service exposes:

```sh
curl http://127.0.0.1:8003/status
curl 'http://127.0.0.1:8003/evidence/sections?bbox=-1.7,52.7,-1.5,52.9&source=osm_gps_2013'
curl -X POST http://127.0.0.1:8003/route-evidence \
  -H 'Content-Type: application/json' \
  -d '{"edges":[{"wayId":123456,"coordinates":[[-1.5,52.8],[-1.499,52.801]]}],"sources":["osm_gps_2013","osm_route_running"],"includeSegments":true}'
curl -X POST http://127.0.0.1:8003/route-evidence/batch \
  -H 'Content-Type: application/json' \
  -d '{"includeSegments":false,"routes":[{"id":"candidate-a","edges":[{"wayId":123456,"coordinates":[[-1.5,52.8],[-1.499,52.801]]}]}]}'
```

`includeSegments` defaults to `true` on `/route-evidence` for compatibility. When it is `false`, the response contains `routeDistanceM`, `evidencedDistanceM`, and `evidencedFraction` but does not construct or return `segments`. The batch endpoint accepts one to six uniquely identified routes, defaults to summary mode, loads the union of their way IDs once, and returns the identifier alongside each result. `sources` applies equally to every route in a batch; omitting it selects all sources.

Route lookup selects evidenced sections for all supplied way IDs in one query, groups edges by way, then uses Shapely 2 arrays to decode, project, buffer, intersect, union, and transform geometry. Evidence overlaps are unioned within each edge so sources never double-count, while repeated traversal supplied as another edge counts again. Missing way IDs and unmatched sections remain unknown. A thread-safe 128 MB LRU retains projected section geometry and prepared 2.5 m buffers. Six reusable request workers each retain one immutable read-only SQLite connection, bounding simultaneous geometry work and process growth.

Viewport lookup returns section geometry, source labels, and references from one joined query. A viewport containing more than 5,000 sections returns HTTP 413 with `code: "viewport_too_broad"` and `limit: 5000`; the browser keeps the previous overlay and asks the user to zoom in. Request bodies are limited to 10 MiB. Invalid JSON, unknown sources, and excessive batches return a stable machine-readable `code` alongside the human-readable `error`.

Every request logs total, SQL, geometry, and JSON serialization milliseconds as one structured line. Logs contain the endpoint and timings, never route coordinates. The immutable SQLite/RTree design is intentional for this small, single-instance, read-only workload. Reconsider PostGIS only if datasets update independently, writers are introduced, regions are served remotely, or multiple service replicas need shared state; Valhalla remains responsible for graph traversal.

## Manual validation milestones

There are intentionally no automated tests for this prototype. Record observations and the build report while completing these checks:

1. Confirm the archive download resumes, the official MD5 passes, and limited streaming writes no uncompressed members. Record compressed disk use and extrapolated processing time.
2. Inspect short and multi-kilometre current ways. Confirm 25 m boundaries, final partial sections, and identical IDs across unchanged rebuilds.
3. Run the full archive. Review association aggregates and inspect temporary viewport exports around Monsal Trail, Tissington Trail, High Peak Trail, the Trent and Mersey Canal near Burton, and National Forest paths near Swadlincote. Include parallel ways, junctions, bridges, and tunnels.
4. Filter the viewport independently by `osm_gps_2013`, `osm_route_running`, `osm_route_walking`, and `osm_route_cycling`. Confirm overlapping relations have Boolean effect and relation provenance remains visible.
5. Copy a database, alter its stored PBF checksum, and confirm service startup refusal. Exercise all three endpoints; verify multiple selected sources do not double-count and missing records remain neutral.
6. In a normal build, inspect all/source-filtered overlays and click section identity/provenance. On selected routes, confirm solid green evidenced portions and neutral grey dashed unknown portions align with the preserved route line. Confirm the summary says missing evidence is unknown, not unused or unsafe.
7. Generate one candidate set. Confirm the six candidate summaries use one batch request, selecting alternatives does not reroute or rerank, and segment geometry is fetched only after enabling the selected-route overlay. Confirm high-severity routes get no bonus and unknown routes get no penalty. Raw scoring controls must appear only in development.
8. Exercise invalid JSON, a body over 10 MiB, unknown sources, seven-route batches, a viewport over 5,000 sections, cancellation, a stale database copy, and six simultaneous requests. A broad viewport must leave the existing overlay visible.
9. After one warm-up, benchmark captured 5 km, 10 km, and 30 km routes individually in summary and segment modes and as six-route summary batches. Record warmed p95: route requests must remain below 250 ms, six-route batches below 750 ms, viewports of at most 5,000 sections below 250 ms, and RSS under six-request concurrency below 512 MB. Benchmark manually without committing payloads or a harness.

Warning signs worth treating as a negative result include extremely sparse evidence, near-universal road coverage, frequent parallel-way mistakes, unexplained discontinuities, or excessive section marking.

## Deferred pathfinding influence

The next experiment would first upgrade pinned Valhalla 3.8.3 to a release containing `linear_cost_factors`. Before implementation, verify factor semantics and service limits against that chosen release. Upstream accepts GeoJSON or precision-6 polylines, and behavior for overlapping ranges is undefined; see [Valhalla linear cost factors](https://github.com/valhalla/valhalla/pull/5584).

For each candidate search corridor, select only nearby evidenced sections, Boolean-union the selected sources, and merge only contiguous sections belonging to the same OSM way. Emit those as GeoJSON linear features with an intended mild `0.95` factor. Compare identical loop seeds with and without pathfinding influence, recording routing latency, distance changes, repetition, and quality issues. This repository does not currently upgrade Valhalla, send linear cost factors, expand the evidence endpoints, or influence pathfinding.
