#!/usr/bin/env python3
"""Combines per-tile evidence databases into one covering the whole region.

Tiling is sound because a section's identity does not depend on what else was in
the PBF it was built from. `section_id` is `way_id:section_index`, where the
index is a fixed 25 m offset along the way, and `osmium extract --strategy
complete_ways` keeps a way that crosses a tile boundary whole in every tile that
touches it. So a boundary way has the same length, the same section count and
the same geometry in each tile, and the duplicate rows collapse.

They are collapsed rather than summed on purpose. `network_section` is keyed by
a unique `section_id`, so the second copy is ignored; `section_evidence` is
keyed by `(section_id, source_id)`, so evidence for a boundary section is
unioned across the tiles that saw it. That union matters: each tile prefilters
the GPS stream against its own bounds, so one tile can see a trace its
neighbour's prefilter dropped.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from prepare_evidence import SCHEMA_SQL, SOURCE_ROWS, sha256_file

# Metadata that describes how sections were cut rather than what was found. A
# merge across tiles that disagree on these would be meaningless, so it is
# refused rather than resolved.
CONSISTENT_KEYS = (
    "section_length_m",
    "green_proximity_m",
    "water_proximity_m",
    "gps_archive_sha256",
    "gps_archive_md5",
    "gps_archive_complete",
)


def tile_metadata(database: sqlite3.Connection) -> dict[str, str]:
    return {row[0]: row[1] for row in database.execute("SELECT key, value FROM metadata")}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tile", type=Path, action="append", required=True,
                        help="A per-tile database. Repeat for each tile.")
    parser.add_argument("--pbf", type=Path, required=True,
                        help="The whole evidence region's PBF; the service checks this checksum.")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--tile-report", type=Path, action="append", default=[])
    args = parser.parse_args()

    missing = [str(path) for path in args.tile if not path.is_file()]
    if missing:
        raise SystemExit("Missing tile databases: " + ", ".join(missing))

    started = time.monotonic()
    shared: dict[str, str] = {}
    for path in args.tile:
        with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as tile:
            metadata = tile_metadata(tile)
        for key in CONSISTENT_KEYS:
            value = metadata.get(key)
            if key not in shared:
                shared[key] = value
            elif shared[key] != value:
                raise SystemExit(
                    f"Tiles disagree on {key}: {shared[key]!r} vs {value!r} in {path}."
                    " They were not built from the same archive or settings."
                )
    if shared.get("gps_archive_complete") != "true":
        raise SystemExit(
            "At least one tile was built in limited streaming-spike mode."
            " The merged database would be refused at startup."
        )

    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.unlink(missing_ok=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    merged = sqlite3.connect(temporary)
    merged.executescript(SCHEMA_SQL)
    merged.executemany("INSERT INTO evidence_source VALUES (?, ?, ?, ?, ?, ?)", SOURCE_ROWS)

    section_pk = 0
    duplicates = 0
    for path in args.tile:
        merged.execute("ATTACH DATABASE ? AS tile", (str(path),))
        before = merged.execute("SELECT COUNT(*) FROM network_section").fetchone()[0]
        rows = merged.execute(
            "SELECT COUNT(*) FROM tile.network_section"
        ).fetchone()[0]
        # section_pk is a per-tile counter, so it is reassigned here; the r-tree
        # is rebuilt from the merged keys afterwards.
        merged.execute(
            """
            INSERT OR IGNORE INTO network_section
              (section_pk, section_id, way_id, section_index, start_m, end_m,
               geometry_wkb, min_lon, min_lat, max_lon, max_lat)
            SELECT ?1 + ROW_NUMBER() OVER (ORDER BY section_pk),
                   section_id, way_id, section_index, start_m, end_m,
                   geometry_wkb, min_lon, min_lat, max_lon, max_lat
            FROM tile.network_section
            """,
            (section_pk,),
        )
        merged.execute(
            """
            INSERT OR IGNORE INTO section_evidence (section_id, source_id, feature_reference)
            SELECT section_id, source_id, feature_reference FROM tile.section_evidence
            """
        )
        merged.commit()
        after = merged.execute("SELECT COUNT(*) FROM network_section").fetchone()[0]
        added = after - before
        duplicates += rows - added
        section_pk = merged.execute(
            "SELECT COALESCE(MAX(section_pk), 0) FROM network_section"
        ).fetchone()[0]
        print(f"  {path.name}: {rows:,} sections, {added:,} new, {rows - added:,} shared", flush=True)
        merged.execute("DETACH DATABASE tile")

    print("Rebuilding the viewport r-tree…", flush=True)
    merged.execute(
        """
        INSERT INTO network_section_rtree (section_pk, min_lon, max_lon, min_lat, max_lat)
        SELECT section_pk, min_lon, max_lon, min_lat, max_lat FROM network_section
        """
    )

    metadata = {
        # What the service hashes at startup: the whole evidence region, not any
        # one tile. Cutting the tiles out of this exact file is what makes that
        # claim true.
        "osm_pbf_sha256": sha256_file(args.pbf),
        "built_at": datetime.now(timezone.utc).isoformat(),
        "tiles_merged": str(len(args.tile)),
        **{key: shared[key] for key in CONSISTENT_KEYS},
        "source_and_licence_summary": (
            "Current OSM network, tags and route relations: ODbL 1.0;"
            " 2013 OSM GPS archive: CC BY-SA 2.0."
            " Local prototype output; review licensing before redistribution."
        ),
    }
    merged.executemany("INSERT INTO metadata(key, value) VALUES (?, ?)", metadata.items())
    merged.commit()
    print("Compacting…", flush=True)
    merged.execute("VACUUM")

    sections = merged.execute("SELECT COUNT(*) FROM network_section").fetchone()[0]
    by_source = {
        row[0]: row[1]
        for row in merged.execute(
            "SELECT source_id, COUNT(*) FROM section_evidence GROUP BY source_id ORDER BY source_id"
        )
    }
    length_by_source = {
        row[0]: round(row[1], 2)
        for row in merged.execute(
            """
            SELECT se.source_id, SUM(ns.end_m - ns.start_m)
            FROM section_evidence se JOIN network_section ns ON ns.section_id = se.section_id
            GROUP BY se.source_id ORDER BY se.source_id
            """
        )
    }
    merged.close()
    temporary.replace(args.output)

    gps_totals: dict[str, int] = defaultdict(int)
    for path in args.tile_report:
        if not path.is_file():
            continue
        tile_report = json.loads(path.read_text(encoding="utf-8"))
        for key, value in tile_report.items():
            if isinstance(value, int) and not isinstance(value, bool):
                gps_totals[key] += value

    report = {
        "builtAt": metadata["built_at"],
        "mergedFromTiles": len(args.tile),
        "tileDatabases": [str(path) for path in args.tile],
        "sharedSectionsAcrossTileBoundaries": duplicates,
        "archiveSha256": shared["gps_archive_sha256"],
        "archiveMd5": shared["gps_archive_md5"],
        "mergeSeconds": round(time.monotonic() - started, 2),
        "stored_sections": sections,
        "evidenced_sections_by_source": by_source,
        "evidenced_length_m_by_source": length_by_source,
        "output_database_bytes": args.output.stat().st_size,
        # Summed across tiles, so anything counted per archive member is counted
        # once per tile that streamed it. Divide by mergedFromTiles for a
        # per-pass figure; the per-tile reports hold the exact numbers.
        "tileSummedCounters": dict(sorted(gps_totals.items())),
        # Deliberately absent: network_length_m and any_use_evidence_distance_pct.
        # Only evidenced sections are stored, so the unevidenced remainder of the
        # network cannot be recovered from the merged database, and summing it
        # across tiles would double-count every boundary way.
    }
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
