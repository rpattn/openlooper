# Route-use evidence preparation and validation

This is supported local product functionality, not a popularity or safety model.

> No route-use evidence means unknown, not unused, unsafe or unsuitable.

## What each source claims

Every row is still one Boolean per 25 m section, but the sources no longer all
make the same kind of statement. `evidence_source.kind` separates three:

| kind | claim | sources |
| --- | --- | --- |
| `use` | somebody is recorded as having travelled here | `gps_foot_2013`, `gps_cycle_2013`, `gps_vehicle_2013`, `gps_unclassified_2013`, `osm_route_running`, `osm_route_walking`, `osm_route_cycling` |
| `status` | the way carries a recorded legal or network designation | `row_footpath`, `row_bridleway`, `row_byway`, `osm_network_walking_major`, `osm_network_cycling_major` |
| `context` | something is recorded about the way's surroundings | `near_green`, `near_water`, `lit_recorded`, `speed_limit_low`, `speed_limit_high` |

**A `status` or `context` row is not evidence of use.** A recorded public
footpath says the right of way exists, not that anyone walked it. The map
overlay groups the picker under these three headings for that reason.

## Sources and licensing

The historical coordinate input is the official OpenStreetMap [`gpx-planet-2013-04-09.tar.xz`](https://planet.openstreetmap.org/gps/gpx-planet-2013-04-09.tar.xz), with its published [MD5 file](https://planet.openstreetmap.org/gps/gpx-planet-2013-04-09.tar.xz.md5). The [official GPS archive directory](https://planet.openstreetmap.org/gps/) describes the archive as approximately 21 GB compressed and labels the GPS material CC BY-SA 2.0. The smaller `simple-gps-points-120312.txt.xz` is from 2012 and is deliberately not used. Background is in the OSM [Planet.gpx documentation](https://wiki.openstreetmap.org/wiki/Planet.gpx).

Current network geometry, `designation`, `lit` and `maxspeed` tags, greenspace
and water features, and accepted `running`, `foot`, `hiking`, `bicycle`, and `mtb` [route relations](https://wiki.openstreetmap.org/wiki/Route) come from the exact regional PBF used by Valhalla and are attributed © OpenStreetMap contributors under ODbL 1.0. Only empty and `main` way-member roles are accepted; proposed relations are ignored.

The build stores both source summaries and provenance. This output is for local prototype use. Do not redistribute the source archive or derived database without a separate licensing review.

## Mode classification

The archive's `identifiable` members carry `<time>` at 1 Hz. The builder derives
a speed from consecutive timestamped points inside one track segment, averaged
over a window of five pairs either side so a pause at a junction does not
reclassify the points around it, and assigns each point a mode:

| band | source | km/h |
| --- | --- | --- |
| walking or running | `gps_foot_2013` | 2.0–9.0 |
| cycling | `gps_cycle_2013` | 12.0–30.0 |
| vehicle | `gps_vehicle_2013` | 40.0 and above |
| anything else | `gps_unclassified_2013` | in a gap, untimed, or fewer than five usable pairs |

The gaps between the bands are deliberate: a point is only claimed for a mode
when its speed is unambiguous, so a fast runner and a slow cyclist both land in
`gps_unclassified_2013` rather than contaminating either. Pairs spanning more
than 60 seconds are treated as a pause, not a movement.

Speeds are computed, used, and discarded inside the streaming pass. No
coordinate, timestamp, contributor, track structure, ordering or journey is
retained — only the same per-section Booleans as before, now carrying which
mode produced them. Traces uploaded as `public` are anonymised by OSM and have
no usable timing, so they can only ever reach `gps_unclassified_2013`; the build
report counts members by visibility class so that cost is measured, not assumed.

**Why this matters.** The undifferentiated 2013 source covered 83% of
residential ways and 68% of trunk/primary against 39% of footway and 22% of
track: it measured where people drove, so a route-use bonus built on it rewarded
staying on roads. Splitting by mode is what makes the signal usable for a
walking or running route.

## Recorded status and context

- **Rights of way.** `designation=public_footpath|public_bridleway|restricted_byway|byway_open_to_all_traffic` is present on about 10.6% of the region's highway ways and marks every section of the way.
- **Network tier.** `iwn`/`nwn`/`rwn` and `icn`/`ncn`/`rcn` relations additionally mark `osm_network_walking_major` and `osm_network_cycling_major`, so a National Cycle Network route is distinguishable from a parish waymarked circular.
- **Greenspace and water.** A section is marked when its **midpoint** lies within 10 m of recorded greenspace or 30 m of recorded water. Greenspace deliberately excludes `landuse=grass`, `leisure=pitch` and `natural=tree_row`: including them marked 59% of trunk road as green against 55% of footway, which discriminates nothing. At 10 m with those excluded, the measured split is roughly 54% of path and 61% of track against 11% of trunk and 5% of residential.
- **Lighting and speed limit.** `lit` and `maxspeed` are carried through as `lit_recorded`, `speed_limit_low` (30 mph or less) and `speed_limit_high` (50 mph or more). Coverage is partial — around 9–10% of ways — so absence stays "not recorded", never proof.

## Resources and commands

Allow roughly 21 GB for the retained compressed archive, a few GB for Docker,
cache and temporary database work, and 2–4 GB RAM. **The build takes about 40
minutes** on a 20-core machine, down from 7h27m.

```sh
npm run evidence:down     # the running service holds the old database open
npm run evidence:prepare
npm run evidence:up
```

`evidence:prepare` resumes the archive download, retrieves the official MD5,
verifies the complete compressed file, builds the pinned Python 3.12 image, and
creates:

- `docker/evidence/data/route-use-evidence.sqlite`
- `docker/evidence/data/build-report.json`
- retained compressed input under the ignored `docker/evidence/data/sources/`

Progress prints every 30 seconds with the share of the archive consumed, members
seen, and a running estimate of the time left:

```
  [00:04:30]  13.4% ·   3.0/22.3 GB · 71,104 members · 693 in the region's bands · 184,220 coordinates matched · about 00:29:02 left
```

### Where the time goes

Three changes account for the speed-up, each measured on this archive:

| stage | before | after |
| --- | --- | --- |
| decompress and read the tar | 0.30 h | 0.30 h — the floor, and single-threaded because the archive is one xz block |
| find coordinates in each member | 4.38 h with `lxml` tree building | 1.20 h scanning bytes for the point tags directly |
| members reaching the parser | all of them | 1.2% of members, 0.62% of bytes, after a byte prefilter |
| associating coordinates with ways | serial, one point at a time | vectorised, spread over `--workers` processes |

The **prefilter** rejects a member unless its bytes contain a latitude *and* a
longitude prefix from the region's whole-degree bands. Whole degrees only, so it
is a necessary condition: it can pass a member holding no in-region coordinate,
but it can never reject one that holds an in-region coordinate. Run with
`--no-prefilter` to parse every member and compare.

Matching is parallel, but streaming and decompressing the archive stays on one
core and sets the floor, so `--workers` beyond about eight buys little.
`EVIDENCE_WORKERS=n npm run evidence:prepare` overrides the default of
`nproc - 2`.

For an archive-streaming spike without a runtime-valid database, run the
preparation container directly with `--gps-member-limit N`. Limited builds are
marked incomplete and the service refuses them.

## Association rules

The builder projects current linear `highway=*` geometries to EPSG:27700 and divides every way into consecutive 25 m sections. IDs are build-local and deterministic: `way_id:section_index`. The final section may be shorter. Replacing the PBF requires a complete rebuild; there is no identity migration.

Each GPX coordinate is handled independently. The candidate lookup, distance
computation and grouping are vectorised across all of a member's in-region
coordinates at once, but the decision rules and their tie-break order are
unchanged:

1. Reject coordinates outside the current network bounds plus 50 m.
2. Find nearby current OSM ways in a spatial index.
3. Accept the nearest only within 18 m.
4. Reject when another way is within 6 m of the winner's distance.
5. Classify a close competing way with different `bridge`, `tunnel`, or `layer` tags as a vertical-structure conflict.
6. Project an accepted point onto the winning way and mark its 25 m section.

One coordinate is enough; duplicates do not add strength. Route relations, rights of way, lighting and speed limits mark every section of the way that carries them. One optional relation ID is retained per section/source, but overlapping relations and multiple sources never add weight.

## SQLite and HTTP behavior

The database contains metadata, source descriptions (now including `kind`), evidenced `network_section` rows, unique `(section_id, source_id)` records, indexes by way/source, and an RTree for viewport lookup. Adding rights of way and greenspace roughly doubles the number of stored sections and takes the database from about 147 MB to about 300 MB; the `stored_sections` figure in the build report is the number to watch. A denser database also reaches the 5,000-section viewport limit at a lower zoom, so `MAX_VIEWPORT_SECTIONS` in `evidence_service.py` may need raising. Each `network_section.geometry_wkb` is the unsimplified WGS84 `LineString` produced by transforming the exact projected 25 m substring boundaries (with only a shorter final section). Stored section geometry is never buffered, simplified, unioned, or replaced with route-overlap geometry. Metre offsets and matching use EPSG:27700.

The private read-only service exposes:

```sh
curl http://127.0.0.1:8003/status
curl 'http://127.0.0.1:8003/evidence/sections?bbox=-1.7,52.7,-1.5,52.9&source=osm_gps_2013'
curl -X POST http://127.0.0.1:8003/route-evidence \
  -H 'Content-Type: application/json' \
  -d '{"edges":[{"wayId":123456,"coordinates":[[-1.5,52.8],[-1.499,52.801]]}],"sources":["gps_foot_2013","row_footpath"],"includeSegments":true}'
curl -X POST http://127.0.0.1:8003/route-evidence \
  -H 'Content-Type: application/json' \
  -d '{"encodedPolyline":"...","edges":[{"wayId":123456,"beginIndex":0,"endIndex":7}],"includeSegments":false,"breakdown":true}'
curl -X POST http://127.0.0.1:8003/route-evidence/batch \
  -H 'Content-Type: application/json' \
  -d '{"includeSegments":false,"routes":[{"id":"candidate-a","edges":[{"wayId":123456,"coordinates":[[-1.5,52.8],[-1.499,52.801]]}]}]}'
```

A route may send its shape once as `encodedPolyline` with each edge carrying a `beginIndex`/`endIndex` range into it, instead of repeating coordinates per edge. Both forms are accepted and produce identical answers; the range form is about 40% smaller on a 12 km route and does not grow with route length the way the coordinate form does.

`breakdown: true` adds `bySource`, giving `evidencedDistanceM` and `evidencedFraction` per source. Per-source distance sums the overlaps of the sections carrying that source rather than unioning them, so a value can sit slightly above the union share where sections meet; it is a ranking input, and `evidencedDistanceM` remains the headline figure. The breakdown reuses overlap lengths the calculation already produces, so it costs no extra geometry work.

`includeSegments` defaults to `true` on `/route-evidence` for compatibility. When it is `false`, the response contains `routeDistanceM`, `evidencedDistanceM`, and `evidencedFraction` but does not construct or return `segments`. The batch endpoint accepts one to six uniquely identified routes, defaults to summary mode, loads the union of their way IDs once, and returns the identifier alongside each result. `sources` applies equally to every route in a batch; omitting it selects all sources.

Route lookup selects evidenced sections for all supplied way IDs in one query, groups edges by way, then uses Shapely 2 arrays to decode, project, buffer, intersect, union, and transform geometry. Evidence overlaps are unioned within each edge so sources never double-count, while repeated traversal supplied as another edge counts again. Missing way IDs and unmatched sections remain unknown. A thread-safe 128 MB LRU retains projected section geometry and prepared 2.5 m buffers. Six reusable request workers each retain one immutable read-only SQLite connection, bounding simultaneous geometry work and process growth.

Viewport lookup returns section geometry, source labels, and references from one joined query. A viewport containing more than 5,000 sections returns HTTP 413 with `code: "viewport_too_broad"` and `limit: 5000`; the browser keeps the previous overlay and asks the user to zoom in. Request bodies are limited to 10 MiB. Invalid JSON, unknown sources, and excessive batches return a stable machine-readable `code` alongside the human-readable `error`.

Every request logs total, SQL, geometry, and JSON serialization milliseconds as one structured line. Logs contain the endpoint and timings, never route coordinates. The immutable SQLite/RTree design is intentional for this small, single-instance, read-only workload. Reconsider PostGIS only if datasets update independently, writers are introduced, regions are served remotely, or multiple service replicas need shared state; Valhalla remains responsible for graph traversal.

## How ranking uses these sources

Not every source is a ranking input, and the ones that are do not all pull the
same way. `src/domain/route-character.ts` holds the weights, applied to the
share of route distance each source covers and summed into a character term
between -1 and 1.

- **`gps_unclassified_2013` is never used for ranking.** It carries 83% of the
  archive's accepted coordinates, because roughly two thirds of uploaded traces
  are anonymised and have no usable timing, and it covers 82% of residential and
  67% of trunk road against 36% of footway. It measures where the road network
  is. It stays in the database for the overlay and out of the score.
- **`gps_vehicle_2013` is a negative.** It is the mode class that separates most
  cleanly — 19% of trunk and 21% of secondary against 0% of footway, path and
  track — which makes it a measured stand-in for "cars actually drive here".
- **`row_footpath` is the strongest positive on foot**: 35% of footway and 29%
  of track against 0% of trunk, tertiary and residential.
- **`near_green` and `near_water` are context**, weighted lower than a recorded
  right of way because being beside a wood is a weaker claim than being a mapped
  path.

Absent evidence stays neutral. A route with no breakdown gets no character term
at all rather than a zero, so an unmeasured candidate is never ranked as a bad
one.

## Manual validation milestones

There are intentionally no automated tests for this prototype. Record observations and the build report while completing these checks:

1. Confirm the archive download resumes, the official MD5 passes, and limited streaming writes no uncompressed members. Record compressed disk use and extrapolated processing time.
2. Inspect short and multi-kilometre current ways. Confirm 25 m boundaries, final partial sections, and identical IDs across unchanged rebuilds.
3. Run the full archive. Review association aggregates and inspect temporary viewport exports around Monsal Trail, Tissington Trail, High Peak Trail, the Trent and Mersey Canal near Burton, and National Forest paths near Swadlincote. Include parallel ways, junctions, bridges, and tunnels.
4. Filter the viewport independently by each source. Confirm overlapping relations have Boolean effect and relation provenance remains visible, and that the picker groups sources under recorded use, designation and surroundings.
4b. Check the mode split did its job: sample routed edges by highway class and compare `gps_foot_2013` coverage against `gps_vehicle_2013`. Foot evidence must favour footway, path and track; vehicle evidence must favour trunk, primary and secondary. If foot evidence still tracks the road network, the speed bands are wrong and nothing downstream should use them.
5. Copy a database, alter its stored PBF checksum, and confirm service startup refusal. Exercise all three endpoints; verify multiple selected sources do not double-count and missing records remain neutral.
6. In a normal build, inspect all/source-filtered overlays and click section identity/provenance. On selected routes, confirm solid green evidenced portions and neutral grey dashed unknown portions align with the preserved route line. Confirm the summary says missing evidence is unknown, not unused or unsafe.
7. Generate one candidate set. Confirm the six candidate summaries use one batch request, selecting alternatives does not reroute or rerank, and segment geometry is fetched only after enabling the selected-route overlay. Confirm high-severity routes get no bonus and unknown routes get no penalty. Raw scoring controls must appear only in development.
8. Exercise invalid JSON, a body over 10 MiB, unknown sources, seven-route batches, a viewport over 5,000 sections, cancellation, a stale database copy, and six simultaneous requests. A broad viewport must leave the existing overlay visible.
9. After one warm-up, benchmark captured 5 km, 10 km, and 30 km routes individually in summary and segment modes and as six-route summary batches. Record warmed p95: route requests must remain below 250 ms, six-route batches below 750 ms, viewports of at most 5,000 sections below 250 ms, and RSS under six-request concurrency below 512 MB. Benchmark manually without committing payloads or a harness.

Warning signs worth treating as a negative result include extremely sparse evidence, near-universal road coverage, frequent parallel-way mistakes, unexplained discontinuities, excessive section marking, or a `gps_foot_2013` layer that looks like the road network.

The build report also carries `members_prefiltered_out` beside `members_scanned`. A prefilter that rejects far more or far less than about 98–99% of members is the first thing to check if evidence looks wrong.

## Deferred pathfinding influence

The next experiment would first upgrade pinned Valhalla 3.8.3 to a release containing `linear_cost_factors`. Before implementation, verify factor semantics and service limits against that chosen release. Upstream accepts GeoJSON or precision-6 polylines, and behavior for overlapping ranges is undefined; see [Valhalla linear cost factors](https://github.com/valhalla/valhalla/pull/5584).

For each candidate search corridor, select only nearby evidenced sections of the sources that suit the activity — foot-speed evidence, rights of way and green corridors for a run, rather than every source at once — Boolean-union them, and merge only contiguous sections belonging to the same OSM way. Emit those as GeoJSON linear features with an intended mild `0.95` factor. Compare identical loop seeds with and without pathfinding influence, recording routing latency, distance changes, repetition, and quality issues. This repository does not currently upgrade Valhalla, send linear cost factors, expand the evidence endpoints, or influence pathfinding.
