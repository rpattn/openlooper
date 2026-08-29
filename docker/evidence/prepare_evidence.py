#!/usr/bin/env python3
"""Build a section-level, Boolean route-use evidence database."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sqlite3
import tarfile
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO

import osmium
from lxml import etree
from pyproj import Transformer
from shapely import wkb
from shapely.geometry import LineString, Point
from shapely.ops import substring, transform
from shapely.strtree import STRtree

SECTION_LENGTH_M = 25.0
MAX_DISTANCE_M = 18.0
AMBIGUITY_M = 6.0
REGION_MARGIN_M = 50.0
SOURCE_ROWS = (
    (
        "osm_gps_2013",
        "OSM historical GPS coordinates (2013)",
        "https://planet.openstreetmap.org/gps/gpx-planet-2013-04-09.tar.xz",
        "CC BY-SA 2.0",
        "OpenStreetMap contributors; GPS archive published by OpenStreetMap Foundation",
    ),
    (
        "osm_route_running",
        "Current OSM running route relations",
        "https://wiki.openstreetmap.org/wiki/Route",
        "ODbL 1.0",
        "© OpenStreetMap contributors",
    ),
    (
        "osm_route_walking",
        "Current OSM walking and hiking route relations",
        "https://wiki.openstreetmap.org/wiki/Route",
        "ODbL 1.0",
        "© OpenStreetMap contributors",
    ),
    (
        "osm_route_cycling",
        "Current OSM bicycle and mountain-bike route relations",
        "https://wiki.openstreetmap.org/wiki/Route",
        "ODbL 1.0",
        "© OpenStreetMap contributors",
    ),
)
ROUTE_SOURCES = {
    "running": "osm_route_running",
    "foot": "osm_route_walking",
    "hiking": "osm_route_walking",
    "bicycle": "osm_route_cycling",
    "mtb": "osm_route_cycling",
}


@dataclass(frozen=True)
class NetworkWay:
    way_id: int
    line_wgs84: LineString
    line_projected: LineString
    vertical: tuple[str, str, str]

    @property
    def length_m(self) -> float:
        return self.line_projected.length

    @property
    def section_count(self) -> int:
        return max(1, math.ceil(self.length_m / SECTION_LENGTH_M))


class NetworkHandler(osmium.SimpleHandler):
    def __init__(self, to_projected: Transformer) -> None:
        super().__init__()
        self.factory = osmium.geom.WKBFactory()
        self.to_projected = to_projected
        self.ways: dict[int, NetworkWay] = {}
        self.route_members: dict[tuple[int, str], str] = {}

    def way(self, way: osmium.osm.Way) -> None:
        if not way.tags.get("highway"):
            return
        try:
            geometry = wkb.loads(self.factory.create_linestring(way), hex=True)
        except (RuntimeError, ValueError):
            return
        if not isinstance(geometry, LineString) or geometry.is_empty:
            return
        projected = transform(self.to_projected.transform, geometry)
        if projected.length <= 0:
            return
        vertical = (
            (way.tags.get("bridge") or "no").lower(),
            (way.tags.get("tunnel") or "no").lower(),
            way.tags.get("layer") or "0",
        )
        self.ways[way.id] = NetworkWay(way.id, geometry, projected, vertical)

    def relation(self, relation: osmium.osm.Relation) -> None:
        if relation.tags.get("type") != "route":
            return
        route_type = (relation.tags.get("route") or "").lower()
        source = ROUTE_SOURCES.get(route_type)
        if not source:
            return
        if (relation.tags.get("state") or "").lower() == "proposed":
            return
        if relation.tags.get("proposed") or relation.tags.get("proposal"):
            return
        reference = str(relation.id)
        for member in relation.members:
            if member.type == "w" and member.role in ("", "main"):
                self.route_members.setdefault((member.ref, source), reference)


class HashingReader:
    def __init__(self, raw: BinaryIO) -> None:
        self.raw = raw
        self.sha256 = hashlib.sha256()
        self.md5 = hashlib.md5(usedforsecurity=False)

    def read(self, size: int = -1) -> bytes:
        chunk = self.raw.read(size)
        self.sha256.update(chunk)
        self.md5.update(chunk)
        return chunk

    def __getattr__(self, name: str):
        return getattr(self.raw, name)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inside_bounds(lon: float, lat: float, bounds: tuple[float, float, float, float]) -> bool:
    west, south, east, north = bounds
    return west <= lon <= east and south <= lat <= north


def xml_coordinates(member_file: BinaryIO):
    context = etree.iterparse(member_file, events=("end",), recover=True, huge_tree=True)
    for _, element in context:
        name = etree.QName(element).localname
        if name in ("trkpt", "rtept", "wpt"):
            try:
                yield float(element.get("lon")), float(element.get("lat"))
            except (TypeError, ValueError):
                pass
        element.clear()
        parent = element.getparent()
        while parent is not None and element.getprevious() is not None:
            del parent[0]


def stream_gps(
    archive: Path,
    ways: list[NetworkWay],
    evidence: dict[tuple[int, int], dict[str, str | None]],
    bounds_wgs84: tuple[float, float, float, float],
    to_projected: Transformer,
    member_limit: int | None,
) -> tuple[dict[str, int], str, str]:
    stats = defaultdict(int)
    geometries = [way.line_projected for way in ways]
    index = STRtree(geometries)
    members = 0
    with archive.open("rb") as raw:
        hashing = HashingReader(raw)
        with tarfile.open(fileobj=hashing, mode="r|xz") as tar:
            for member in tar:
                if not member.isfile() or not member.name.lower().endswith(".gpx"):
                    continue
                extracted = tar.extractfile(member)
                if extracted is None:
                    continue
                members += 1
                for lon, lat in xml_coordinates(extracted):
                    stats["coordinates_parsed"] += 1
                    if not inside_bounds(lon, lat, bounds_wgs84):
                        continue
                    stats["coordinates_inside_region"] += 1
                    x, y = to_projected.transform(lon, lat)
                    point = Point(x, y)
                    candidate_indices = index.query(point.buffer(MAX_DISTANCE_M + AMBIGUITY_M))
                    distances = sorted(
                        ((geometries[int(i)].distance(point), int(i)) for i in candidate_indices),
                        key=lambda item: (item[0], ways[item[1]].way_id),
                    )
                    if not distances or distances[0][0] > MAX_DISTANCE_M:
                        stats["rejected_distance"] += 1
                        continue
                    winner_distance, winner_index = distances[0]
                    winner = ways[winner_index]
                    competing = [
                        (distance, ways[other_index])
                        for distance, other_index in distances[1:]
                        if distance - winner_distance <= AMBIGUITY_M
                    ]
                    if any(other.vertical != winner.vertical for _, other in competing):
                        stats["rejected_vertical_structure"] += 1
                        continue
                    if competing:
                        stats["rejected_ambiguity"] += 1
                        continue
                    offset = winner.line_projected.project(point)
                    section_index = min(
                        winner.section_count - 1,
                        int(offset // SECTION_LENGTH_M),
                    )
                    evidence[(winner.way_id, section_index)]["osm_gps_2013"] = None
                    stats["accepted"] += 1
                if member_limit is not None and members >= member_limit:
                    break
        if member_limit is None:
            for _ in iter(lambda: hashing.read(1024 * 1024), b""):
                pass
        # A limited spike intentionally reports the checksum of only bytes consumed.
        return dict(stats), hashing.sha256.hexdigest(), hashing.md5.hexdigest()


def create_database(
    output: Path,
    ways: dict[int, NetworkWay],
    evidence: dict[tuple[int, int], dict[str, str | None]],
    metadata: dict[str, str],
    to_wgs84: Transformer,
) -> None:
    temporary = output.with_suffix(output.suffix + ".tmp")
    if temporary.exists():
        temporary.unlink()
    database = sqlite3.connect(temporary)
    database.executescript(
        """
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE evidence_source (
          source_id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          source_url TEXT NOT NULL,
          licence TEXT NOT NULL,
          attribution TEXT NOT NULL
        );
        CREATE TABLE network_section (
          section_pk INTEGER PRIMARY KEY,
          section_id TEXT NOT NULL UNIQUE,
          way_id INTEGER NOT NULL,
          section_index INTEGER NOT NULL,
          start_m REAL NOT NULL,
          end_m REAL NOT NULL,
          geometry_wkb BLOB NOT NULL,
          min_lon REAL NOT NULL,
          min_lat REAL NOT NULL,
          max_lon REAL NOT NULL,
          max_lat REAL NOT NULL
        );
        CREATE TABLE section_evidence (
          section_id TEXT NOT NULL REFERENCES network_section(section_id),
          source_id TEXT NOT NULL REFERENCES evidence_source(source_id),
          feature_reference TEXT,
          PRIMARY KEY (section_id, source_id)
        ) WITHOUT ROWID;
        CREATE INDEX network_section_way_id ON network_section(way_id);
        CREATE INDEX section_evidence_lookup ON section_evidence(section_id, source_id);
        CREATE VIRTUAL TABLE network_section_rtree USING rtree(
          section_pk, min_lon, max_lon, min_lat, max_lat
        );
        """
    )
    database.executemany("INSERT INTO metadata(key, value) VALUES (?, ?)", metadata.items())
    database.executemany(
        "INSERT INTO evidence_source VALUES (?, ?, ?, ?, ?)", SOURCE_ROWS
    )
    section_pk = 0
    for (way_id, section_index), sources in sorted(evidence.items()):
        way = ways.get(way_id)
        if way is None or not sources:
            continue
        start_m = section_index * SECTION_LENGTH_M
        end_m = min(way.length_m, start_m + SECTION_LENGTH_M)
        projected_section = substring(way.line_projected, start_m, end_m)
        section = transform(to_wgs84.transform, projected_section)
        if not isinstance(section, LineString) or section.is_empty:
            continue
        section_pk += 1
        section_id = f"{way_id}:{section_index}"
        min_lon, min_lat, max_lon, max_lat = section.bounds
        database.execute(
            "INSERT INTO network_section VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                section_pk,
                section_id,
                way_id,
                section_index,
                start_m,
                end_m,
                sqlite3.Binary(section.wkb),
                min_lon,
                min_lat,
                max_lon,
                max_lat,
            ),
        )
        database.execute(
            "INSERT INTO network_section_rtree VALUES (?, ?, ?, ?, ?)",
            (section_pk, min_lon, max_lon, min_lat, max_lat),
        )
        database.executemany(
            "INSERT INTO section_evidence VALUES (?, ?, ?)",
            ((section_id, source, reference) for source, reference in sorted(sources.items())),
        )
    database.commit()
    database.execute("VACUUM")
    database.close()
    os.replace(temporary, output)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pbf", type=Path, required=True)
    parser.add_argument("--gps-archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument(
        "--gps-member-limit",
        type=int,
        help="Streaming-spike mode; do not use this output as a complete build.",
    )
    args = parser.parse_args()
    started = time.monotonic()
    to_projected = Transformer.from_crs(4326, 27700, always_xy=True)
    to_wgs84 = Transformer.from_crs(27700, 4326, always_xy=True)

    print("Reading current highway network and route relations…", flush=True)
    handler = NetworkHandler(to_projected)
    handler.apply_file(str(args.pbf), locations=True, idx="flex_mem")
    ways = handler.ways
    if not ways:
        raise SystemExit("The regional PBF contains no usable highway geometries.")
    evidence: dict[tuple[int, int], dict[str, str | None]] = defaultdict(dict)
    for (way_id, source), reference in handler.route_members.items():
        way = ways.get(way_id)
        if way is None:
            continue
        for section_index in range(way.section_count):
            evidence[(way_id, section_index)].setdefault(source, reference)

    way_bounds = [way.line_projected.bounds for way in ways.values()]
    min_x = min(bounds[0] for bounds in way_bounds)
    min_y = min(bounds[1] for bounds in way_bounds)
    max_x = max(bounds[2] for bounds in way_bounds)
    max_y = max(bounds[3] for bounds in way_bounds)
    west, south = to_wgs84.transform(min_x - REGION_MARGIN_M, min_y - REGION_MARGIN_M)
    east, north = to_wgs84.transform(max_x + REGION_MARGIN_M, max_y + REGION_MARGIN_M)
    bounds_wgs84 = (west, south, east, north)

    print("Streaming compressed GPX members without extracting them…", flush=True)
    gps_stats, gps_sha256, gps_md5 = stream_gps(
        args.gps_archive,
        list(ways.values()),
        evidence,
        bounds_wgs84,
        to_projected,
        args.gps_member_limit,
    )
    pbf_sha256 = sha256_file(args.pbf)
    built_at = datetime.now(timezone.utc).isoformat()
    metadata = {
        "osm_pbf_sha256": pbf_sha256,
        "gps_archive_sha256": gps_sha256,
        "gps_archive_md5": gps_md5,
        "gps_archive_complete": str(args.gps_member_limit is None).lower(),
        "built_at": built_at,
        "section_length_m": str(SECTION_LENGTH_M),
        "source_and_licence_summary": "Current OSM network and route relations: ODbL 1.0; 2013 OSM GPS archive: CC BY-SA 2.0. Local prototype output; review licensing before redistribution.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    create_database(args.output, ways, evidence, metadata, to_wgs84)

    network_sections = sum(way.section_count for way in ways.values())
    network_length = sum(way.length_m for way in ways.values())
    source_lengths = {}
    source_sections = {}
    for source, *_ in SOURCE_ROWS:
        keys = [key for key, values in evidence.items() if source in values]
        source_sections[source] = len(keys)
        source_lengths[source] = round(
            sum(
                min(SECTION_LENGTH_M, ways[way_id].length_m - index * SECTION_LENGTH_M)
                for way_id, index in keys
                if way_id in ways
            ),
            2,
        )
    any_length = sum(
        min(SECTION_LENGTH_M, ways[way_id].length_m - index * SECTION_LENGTH_M)
        for way_id, index in evidence
        if way_id in ways and evidence[(way_id, index)]
    )
    report = {
        "builtAt": built_at,
        "limitedGpsMemberSpike": args.gps_member_limit is not None,
        "archiveSha256": gps_sha256,
        "archiveMd5": gps_md5,
        "processingSeconds": round(time.monotonic() - started, 2),
        **gps_stats,
        "rejected_associations": sum(
            gps_stats.get(key, 0)
            for key in ("rejected_distance", "rejected_ambiguity", "rejected_vertical_structure")
        ),
        "network_sections": network_sections,
        "network_length_m": round(network_length, 2),
        "evidenced_sections_by_source": source_sections,
        "evidenced_length_m_by_source": source_lengths,
        "any_evidence_distance_pct": round(100 * any_length / network_length, 3),
        "output_database_bytes": args.output.stat().st_size,
    }
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
