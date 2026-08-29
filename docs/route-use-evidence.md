# Route-use evidence preparation and validation

This is a local prototype experiment, not a popularity or safety model.

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

The database contains metadata, source descriptions, evidenced `network_section` rows, unique `(section_id, source_id)` records, indexes by way/source, and an RTree for viewport lookup. Geometry is WGS84 WKB; metre offsets and matching use EPSG:27700.

The private read-only service exposes:

```sh
curl http://127.0.0.1:8003/status
curl 'http://127.0.0.1:8003/evidence/sections?bbox=-1.7,52.7,-1.5,52.9&source=osm_gps_2013'
curl -X POST http://127.0.0.1:8003/route-evidence \
  -H 'Content-Type: application/json' \
  -d '{"edges":[{"wayId":123456,"coordinates":[[-1.5,52.8],[-1.499,52.801]]}],"sources":["osm_gps_2013","osm_route_running"]}'
```

Route lookup first selects evidenced sections for the supplied way IDs, then intersects them with each exact attributed edge geometry. Evidence overlaps are unioned within each edge so sources never double-count, while repeated traversal supplied as another edge counts again. Missing way IDs and unmatched sections remain unknown.

## Manual validation milestones

There are intentionally no automated tests for this prototype. Record observations and the build report while completing these checks:

1. Confirm the archive download resumes, the official MD5 passes, and limited streaming writes no uncompressed members. Record compressed disk use and extrapolated processing time.
2. Inspect short and multi-kilometre current ways. Confirm 25 m boundaries, final partial sections, and identical IDs across unchanged rebuilds.
3. Run the full archive. Review association aggregates and inspect temporary viewport exports around Monsal Trail, Tissington Trail, High Peak Trail, the Trent and Mersey Canal near Burton, and National Forest paths near Swadlincote. Include parallel ways, junctions, bridges, and tunnels.
4. Filter the viewport independently by `osm_gps_2013`, `osm_route_running`, `osm_route_walking`, and `osm_route_cycling`. Confirm overlapping relations have Boolean effect and relation provenance remains visible.
5. Copy a database, alter its stored PBF checksum, and confirm service startup refusal. Exercise all three endpoints; verify multiple selected sources do not double-count and missing records remain neutral.
6. In the development map, inspect all/source-filtered overlays and click section identity/provenance. On selected routes, confirm solid green evidenced portions and neutral grey dashed unknown portions align with the preserved route line.
7. Generate one candidate set, then toggle ranking. Confirm no Valhalla requests are triggered, only close ordering can change, high-severity routes get no bonus, and unknown routes get no penalty.
8. Decide from the observed overlays and route comparisons whether the binary layer is useful enough to retain or whether the 2013 material is too sparse/noisy. Either is a valid experimental result; do not infer usefulness before the full local run.

Warning signs worth treating as a negative result include extremely sparse evidence, near-universal road coverage, frequent parallel-way mistakes, unexplained discontinuities, or excessive section marking.
