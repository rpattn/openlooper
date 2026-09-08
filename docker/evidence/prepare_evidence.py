#!/usr/bin/env python3
"""Build a section-level, Boolean route-use evidence database."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sqlite3
import tarfile
import time
from collections import defaultdict
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait
from dataclasses import dataclass
from datetime import datetime, timezone
from multiprocessing import get_context
from pathlib import Path
from typing import BinaryIO

import numpy as np
import osmium
import shapely
from pyproj import Transformer
from shapely import wkb
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.ops import substring, transform
from shapely.strtree import STRtree

SECTION_LENGTH_M = 25.0
MAX_DISTANCE_M = 18.0
AMBIGUITY_M = 6.0
REGION_MARGIN_M = 50.0
CANDIDATE_RADIUS_M = MAX_DISTANCE_M + AMBIGUITY_M
# How near a section's midpoint must be to be recorded as green or watery.
# Greenspace polygons are large and abut almost everything, so 30 m there marked
# more trunk road than footway and discriminated nothing; 10 m separates them by
# about ten to one. Watercourses are mapped as lines, where 30 m is the width of
# a towpath corridor rather than a verge.
GREEN_PROXIMITY_M = 10.0
WATER_PROXIMITY_M = 30.0

# Speed bands used to classify a GPS trace, in km/h, with deliberate gaps
# between them. A trace is only claimed for a mode when its speed is
# unambiguous; anything in a gap stays unclassified rather than being guessed.
FOOT_SPEED_KMH = (2.0, 9.0)
CYCLE_SPEED_KMH = (12.0, 30.0)
VEHICLE_SPEED_KMH = 40.0
# Half-width, in point pairs, of the window each point's speed is averaged over,
# so a single stop at a junction does not reclassify the trace around it.
SPEED_WINDOW_PAIRS = 5
MIN_TIMED_PAIRS = 5
# A pair spanning longer than this is a pause or a gap, not a measured movement.
MAX_PAIR_SECONDS = 60.0

GPS_LICENCE = ("CC BY-SA 2.0", "OpenStreetMap contributors; GPS archive published by OpenStreetMap Foundation")
GPS_URL = "https://planet.openstreetmap.org/gps/gpx-planet-2013-04-09.tar.xz"
OSM_LICENCE = ("ODbL 1.0", "© OpenStreetMap contributors")
ROUTE_URL = "https://wiki.openstreetmap.org/wiki/Route"
TAG_URL = "https://wiki.openstreetmap.org/wiki/Tags"

# (source_id, kind, label, source_url, licence, attribution).
#
# `kind` separates three different claims that must not be read as one thing:
#   use     — somebody is recorded as having travelled here
#   status  — the way carries a recorded legal or network designation
#   context — something recorded about the surroundings of the way
SOURCE_ROWS = (
    ("gps_foot_2013", "use", "2013 GPS traces at walking or running speed", GPS_URL, *GPS_LICENCE),
    ("gps_cycle_2013", "use", "2013 GPS traces at cycling speed", GPS_URL, *GPS_LICENCE),
    ("gps_vehicle_2013", "use", "2013 GPS traces at vehicle speed", GPS_URL, *GPS_LICENCE),
    ("gps_unclassified_2013", "use", "2013 GPS traces without usable timing", GPS_URL, *GPS_LICENCE),
    ("osm_route_running", "use", "Current OSM running route relations", ROUTE_URL, *OSM_LICENCE),
    ("osm_route_walking", "use", "Current OSM walking and hiking route relations", ROUTE_URL, *OSM_LICENCE),
    ("osm_route_cycling", "use", "Current OSM bicycle and mountain-bike route relations", ROUTE_URL, *OSM_LICENCE),
    ("osm_network_walking_major", "status", "National or regional walking network", ROUTE_URL, *OSM_LICENCE),
    ("osm_network_cycling_major", "status", "National or regional cycle network", ROUTE_URL, *OSM_LICENCE),
    ("row_footpath", "status", "Recorded public footpath", TAG_URL, *OSM_LICENCE),
    ("row_bridleway", "status", "Recorded public bridleway", TAG_URL, *OSM_LICENCE),
    ("row_byway", "status", "Recorded byway or restricted byway", TAG_URL, *OSM_LICENCE),
    ("near_green", "context", "Within 30 m of recorded greenspace", TAG_URL, *OSM_LICENCE),
    ("near_water", "context", "Within 30 m of recorded water", TAG_URL, *OSM_LICENCE),
    ("lit_recorded", "context", "Recorded as lit", TAG_URL, *OSM_LICENCE),
    ("speed_limit_low", "context", "Recorded speed limit of 30 mph or less", TAG_URL, *OSM_LICENCE),
    ("speed_limit_high", "context", "Recorded speed limit of 50 mph or more", TAG_URL, *OSM_LICENCE),
)

ROUTE_SOURCES = {
    "running": "osm_route_running",
    "foot": "osm_route_walking",
    "hiking": "osm_route_walking",
    "bicycle": "osm_route_cycling",
    "mtb": "osm_route_cycling",
}
# International, national and regional networks are a different claim from a
# parish waymarked circular, so the top tiers get their own source.
MAJOR_WALKING_NETWORKS = {"iwn", "nwn", "rwn"}
MAJOR_CYCLING_NETWORKS = {"icn", "ncn", "rcn"}
DESIGNATION_SOURCES = {
    "public_footpath": "row_footpath",
    "public_bridleway": "row_bridleway",
    "restricted_byway": "row_byway",
    "byway_open_to_all_traffic": "row_byway",
}
# `landuse=grass`, `leisure=pitch` and `natural=tree_row` are deliberately
# absent: they cover verges and amenity grass beside ordinary roads, and
# including them marked 59% of trunk road as green against 55% of footway.
GREEN_TAGS = {
    "natural": {"wood", "scrub", "heath", "grassland"},
    "landuse": {"forest", "meadow", "recreation_ground", "village_green"},
    "leisure": {"park", "garden", "nature_reserve", "recreation_ground"},
}
WATER_TAGS = {
    "natural": {"water", "wetland"},
    "landuse": {"reservoir", "basin"},
    "waterway": {"river", "stream", "canal", "riverbank"},
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


def speed_limit_source(value: str | None) -> str | None:
    """Classifies a recorded `maxspeed` into the low/high bands, or nothing."""
    if not value:
        return None
    text = value.strip().lower()
    if text in ("walk", "none", "signals", "variable"):
        return None
    match = re.match(r"^(\d+(?:\.\d+)?)\s*(mph)?$", text)
    if not match:
        return None
    number = float(match.group(1))
    kmh = number * 1.609344 if match.group(2) else number
    if kmh <= 48.5:
        return "speed_limit_low"
    if kmh >= 80.0:
        return "speed_limit_high"
    return None


class NetworkHandler(osmium.SimpleHandler):
    """Reads the current highway network, its recorded status and context tags,
    and the route relations its ways belong to."""

    def __init__(self, to_projected: Transformer) -> None:
        super().__init__()
        self.factory = osmium.geom.WKBFactory()
        self.to_projected = to_projected
        self.ways: dict[int, NetworkWay] = {}
        # (way_id, source_id) -> optional reference to the feature that caused it
        self.way_sources: dict[tuple[int, str], str | None] = {}

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

        designation = (way.tags.get("designation") or "").lower()
        row = DESIGNATION_SOURCES.get(designation)
        if row:
            self.way_sources.setdefault((way.id, row), None)
        if (way.tags.get("lit") or "").lower() in ("yes", "24/7", "dusk-dawn", "automatic"):
            self.way_sources.setdefault((way.id, "lit_recorded"), None)
        speed = speed_limit_source(way.tags.get("maxspeed"))
        if speed:
            self.way_sources.setdefault((way.id, speed), None)

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
        network = (relation.tags.get("network") or "").lower()
        sources = [source]
        if source == "osm_route_walking" and network in MAJOR_WALKING_NETWORKS:
            sources.append("osm_network_walking_major")
        if source == "osm_route_cycling" and network in MAJOR_CYCLING_NETWORKS:
            sources.append("osm_network_cycling_major")
        reference = str(relation.id)
        for member in relation.members:
            if member.type == "w" and member.role in ("", "main"):
                for entry in sources:
                    self.way_sources.setdefault((member.ref, entry), reference)


def matches(tags, table: dict[str, set[str]]) -> bool:
    return any(tags.get(key) in values for key, values in table.items())


def read_context_geometries(pbf: Path, to_projected: Transformer) -> tuple[list, list]:
    """Projected greenspace and water geometries, including multipolygons.

    Read in a second pass because assembling areas needs a different processor
    from the one that reads the highway network.
    """
    factory = osmium.geom.WKBFactory()
    green: list = []
    water: list = []
    processor = (
        osmium.FileProcessor(str(pbf))
        .with_areas()
        .with_filter(osmium.filter.EntityFilter(osmium.osm.AREA))
    )
    for area in processor:
        tags = area.tags
        is_green = matches(tags, GREEN_TAGS)
        is_water = matches(tags, WATER_TAGS)
        if not is_green and not is_water:
            continue
        try:
            geometry = wkb.loads(factory.create_multipolygon(area), hex=True)
        except (RuntimeError, ValueError):
            continue
        if not isinstance(geometry, (Polygon, MultiPolygon)) or geometry.is_empty:
            continue
        projected = transform(to_projected.transform, geometry)
        (water if is_water else green).append(projected)

    # Watercourses are mapped as lines rather than areas, so they need the
    # plain way pass as well.
    class Watercourses(osmium.SimpleHandler):
        def __init__(self) -> None:
            super().__init__()
            self.lines: list = []

        def way(self, way: osmium.osm.Way) -> None:
            if way.tags.get("waterway") not in WATER_TAGS["waterway"]:
                return
            try:
                geometry = wkb.loads(factory.create_linestring(way), hex=True)
            except (RuntimeError, ValueError):
                return
            if not isinstance(geometry, LineString) or geometry.is_empty:
                return
            self.lines.append(transform(to_projected.transform, geometry))

    watercourses = Watercourses()
    watercourses.apply_file(str(pbf), locations=True, idx="flex_mem")
    water.extend(watercourses.lines)
    return green, water


class HashingReader:
    """Hashes the compressed archive as it is consumed, and remembers how far
    through the file it is so progress can be reported."""

    def __init__(self, raw: BinaryIO) -> None:
        self.raw = raw
        self.sha256 = hashlib.sha256()
        self.md5 = hashlib.md5(usedforsecurity=False)
        self.bytes_read = 0

    def read(self, size: int = -1) -> bytes:
        chunk = self.raw.read(size)
        self.sha256.update(chunk)
        self.md5.update(chunk)
        self.bytes_read += len(chunk)
        return chunk

    def __getattr__(self, name: str):
        return getattr(self.raw, name)


# Shared with merge_evidence.py, which builds the same shape from per-tile
# databases. One definition so the two cannot drift apart.
SCHEMA_SQL = """
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE evidence_source (
          source_id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
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


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


# --- GPX scanning -----------------------------------------------------------
#
# The archive's members are written by OSM's own gpx_dump.py, so every point is
# a `<trkpt|rtept|wpt ...>` start tag with double-quoted lat/lon attributes and
# an optional `<time>`. Scanning the bytes for those directly is ~3.6x faster
# than building an XML tree per member and reads exactly the same values.

POINT_TOKEN = re.compile(
    rb'<(?:trkpt|rtept|wpt)\b[^>]*>|<time>([^<]{1,40})</time>|</trkseg>'
)
LAT_ATTR = re.compile(rb'\blat\s*=\s*["\']([-+0-9.eE]+)["\']')
LON_ATTR = re.compile(rb'\blon\s*=\s*["\']([-+0-9.eE]+)["\']')


def integer_parts(low: float, high: float) -> set[str]:
    """The textual integer parts every coordinate in [low, high] can be written
    with. Truncation toward zero, not flooring: -1.6 is written "-1.6"."""
    low, high = min(low, high), max(low, high)
    parts: set[str] = set()
    steps = max(2, int((high - low) / 0.1) + 2)
    for index in range(steps + 1):
        value = low + (high - low) * index / steps
        whole = int(value)
        parts.add(f"-0" if value < 0 and whole == 0 else str(whole))
    return parts


def prefilter_prefixes(
    bounds_wgs84: tuple[float, float, float, float],
) -> tuple[list[bytes], list[bytes]]:
    """Byte substrings a member must contain for any of its points to be in
    region. Whole-degree bands only, so the test is a necessary condition: it
    can pass a member with no in-region point, never reject one that has one."""

    def band(low: float, high: float, attribute: str) -> list[bytes]:
        out: list[bytes] = []
        for part in sorted(integer_parts(low, high)):
            for quote in ('"', "'"):
                out.append(f"{attribute}={quote}{part}.".encode())
                out.append(f"{attribute}={quote}{part}{quote}".encode())
                if not part.startswith("-"):
                    out.append(f"{attribute}={quote}+{part}.".encode())
        return out

    west, south, east, north = bounds_wgs84
    return band(south, north, "lat"), band(west, east, "lon")


def member_passes(data: bytes, lat_prefixes: list[bytes], lon_prefixes: list[bytes]) -> bool:
    # Longitude first: it is the narrower band globally, so it rejects sooner.
    if not any(prefix in data for prefix in lon_prefixes):
        return False
    return any(prefix in data for prefix in lat_prefixes)


def scan_points(data: bytes) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, int]:
    """Longitudes, latitudes, epoch seconds (NaN when absent) and a per-point
    track-segment index, in file order."""
    lons: list[float] = []
    lats: list[float] = []
    times: list[float] = []
    segments: list[int] = []
    segment = 0
    parsed = 0
    for match in POINT_TOKEN.finditer(data):
        token = match.group(0)
        if token == b"</trkseg>":
            segment += 1
            continue
        if token.startswith(b"<time>"):
            # A `<time>` inside the point element belongs to the point before it.
            if lats and math.isnan(times[-1]):
                times[-1] = parse_time(match.group(1))
            continue
        parsed += 1
        lat_match = LAT_ATTR.search(token)
        lon_match = LON_ATTR.search(token)
        if not lat_match or not lon_match:
            continue
        try:
            lat = float(lat_match.group(1))
            lon = float(lon_match.group(1))
        except ValueError:
            continue
        lats.append(lat)
        lons.append(lon)
        times.append(math.nan)
        segments.append(segment)
    return (
        np.asarray(lons, dtype=np.float64),
        np.asarray(lats, dtype=np.float64),
        np.asarray(times, dtype=np.float64),
        np.asarray(segments, dtype=np.int64),
        parsed,
    )


TIME_PATTERN = re.compile(rb"(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})")


def parse_time(value: bytes) -> float:
    """Epoch seconds from an ISO 8601 UTC timestamp. Only differences between
    timestamps are ever used, and nothing derived from one is stored.

    Hand-rolled because `datetime.strptime` is the single most expensive call
    in the scan; the day count is Hinnant's days-from-civil algorithm.
    """
    match = TIME_PATTERN.match(value)
    if not match:
        return math.nan
    year, month, day, hour, minute, second = (int(part) for part in match.groups())
    if not 1 <= month <= 12 or not 1 <= day <= 31:
        return math.nan
    shifted = year - (month <= 2)
    era = (shifted if shifted >= 0 else shifted - 399) // 400
    year_of_era = shifted - era * 400
    day_of_year = (153 * (month + (-3 if month > 2 else 9)) + 2) // 5 + day - 1
    day_of_era = year_of_era * 365 + year_of_era // 4 - year_of_era // 100 + day_of_year
    days = era * 146097 + day_of_era - 719468
    return days * 86400.0 + hour * 3600.0 + minute * 60.0 + second


def classify_speeds(
    x: np.ndarray, y: np.ndarray, times: np.ndarray, segments: np.ndarray
) -> np.ndarray:
    """Per-point mode source id index, derived from a windowed average speed.

    Returns an array of source ids as small integers: 0 unclassified, 1 foot,
    2 cycle, 3 vehicle. Speeds come from consecutive timestamped points inside
    one track segment, averaged over a window so a pause at a junction does not
    reclassify the points around it.
    """
    modes = np.zeros(x.size, dtype=np.int8)
    if x.size < 2:
        return modes
    starts = np.flatnonzero(np.concatenate(([True], segments[1:] != segments[:-1])))
    ends = np.concatenate((starts[1:], [x.size]))
    for start, end in zip(starts, ends):
        count = end - start
        if count < MIN_TIMED_PAIRS + 1:
            continue
        segment_time = times[start:end]
        if np.isnan(segment_time).any():
            continue
        gaps = np.diff(segment_time)
        steps = np.hypot(np.diff(x[start:end]), np.diff(y[start:end]))
        usable = (gaps > 0) & (gaps <= MAX_PAIR_SECONDS)
        if usable.sum() < MIN_TIMED_PAIRS:
            continue
        # Windowed average speed: total distance over total time across the
        # window, which is both cheaper and steadier than a rolling median.
        distance = np.where(usable, steps, 0.0)
        duration = np.where(usable, gaps, 0.0)
        cumulative_distance = np.concatenate(([0.0], np.cumsum(distance)))
        cumulative_duration = np.concatenate(([0.0], np.cumsum(duration)))
        pairs = gaps.size
        indices = np.arange(pairs)
        low = np.maximum(indices - SPEED_WINDOW_PAIRS, 0)
        high = np.minimum(indices + SPEED_WINDOW_PAIRS + 1, pairs)
        window_distance = cumulative_distance[high] - cumulative_distance[low]
        window_duration = cumulative_duration[high] - cumulative_duration[low]
        with np.errstate(invalid="ignore", divide="ignore"):
            kmh = np.where(window_duration > 0, window_distance / window_duration * 3.6, np.nan)
        pair_mode = np.zeros(pairs, dtype=np.int8)
        pair_mode[(kmh >= FOOT_SPEED_KMH[0]) & (kmh <= FOOT_SPEED_KMH[1])] = 1
        pair_mode[(kmh >= CYCLE_SPEED_KMH[0]) & (kmh <= CYCLE_SPEED_KMH[1])] = 2
        pair_mode[kmh >= VEHICLE_SPEED_KMH] = 3
        pair_mode[~usable] = 0
        # A point takes the mode of the pair that starts at it; the last point
        # of a segment takes the pair that ends at it.
        modes[start:end - 1] = pair_mode
        modes[end - 1] = pair_mode[-1]
    return modes


MODE_SOURCES = (
    "gps_unclassified_2013",
    "gps_foot_2013",
    "gps_cycle_2013",
    "gps_vehicle_2013",
)


# --- worker state -----------------------------------------------------------
#
# Built in the parent before the pool forks, so every worker inherits one
# read-only copy of the index rather than being sent a pickled one.

WORKER: dict[str, object] = {}


def match_member(data: bytes) -> tuple[list[tuple[int, int, int]], dict[str, int]]:
    """Associates one GPX member with network sections. Returns the marks it
    produced and the counters it contributed."""
    stats: dict[str, int] = defaultdict(int)
    to_projected = WORKER["to_projected"]
    tree: STRtree = WORKER["tree"]
    geometries = WORKER["geometries"]
    way_ids = WORKER["way_ids"]
    verticals = WORKER["verticals"]
    section_counts = WORKER["section_counts"]
    west, south, east, north = WORKER["bounds"]

    lons, lats, times, segments, parsed = scan_points(data)
    stats["coordinates_parsed"] += parsed
    if lons.size == 0:
        return [], dict(stats)

    inside = (lons >= west) & (lons <= east) & (lats >= south) & (lats <= north)
    if not inside.any():
        return [], dict(stats)

    # Speeds come from the whole trace, before the region filter, because the
    # points either side of the boundary are what make a pair measurable.
    x, y = to_projected.transform(lons, lats)
    modes = classify_speeds(x, y, times, segments)

    stats["coordinates_inside_region"] += int(inside.sum())
    x = x[inside]
    y = y[inside]
    modes = modes[inside]
    points = shapely.points(x, y)

    point_index, tree_index = tree.query(points, predicate="dwithin", distance=CANDIDATE_RADIUS_M)
    if point_index.size == 0:
        stats["rejected_distance"] += int(x.size)
        return [], dict(stats)

    distances = shapely.distance(points[point_index], geometries[tree_index])
    order = np.lexsort((distances, point_index))
    point_index = point_index[order]
    tree_index = tree_index[order]
    distances = distances[order]

    boundaries = np.flatnonzero(np.concatenate(([True], point_index[1:] != point_index[:-1])))
    group_ends = np.concatenate((boundaries[1:], [point_index.size]))
    matched = np.zeros(x.size, dtype=bool)

    marks: list[tuple[int, int, int]] = []
    for start, end in zip(boundaries, group_ends):
        winner_distance = distances[start]
        if winner_distance > MAX_DISTANCE_M:
            continue
        which = point_index[start]
        matched[which] = True
        winner = tree_index[start]
        competing = [
            tree_index[position]
            for position in range(start + 1, end)
            if distances[position] - winner_distance <= AMBIGUITY_M
        ]
        if any(verticals[other] != verticals[winner] for other in competing):
            stats["rejected_vertical_structure"] += 1
            continue
        if competing:
            stats["rejected_ambiguity"] += 1
            continue
        offset = geometries[winner].project(points[which])
        section_index = min(section_counts[winner] - 1, int(offset // SECTION_LENGTH_M))
        marks.append((int(way_ids[winner]), int(section_index), int(modes[which])))
        stats["accepted"] += 1
        stats[f"accepted_{MODE_SOURCES[int(modes[which])]}"] += 1
    stats["rejected_distance"] += int((~matched).sum())
    return marks, dict(stats)


def format_duration(seconds: float) -> str:
    seconds = max(0, int(seconds))
    return f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"


def stream_gps(
    archive: Path,
    bounds_wgs84: tuple[float, float, float, float],
    member_limit: int | None,
    workers: int,
    use_prefilter: bool,
) -> tuple[dict[str, int], dict[tuple[int, int], set[int]], str, str]:
    """Streams the compressed archive, associating GPX coordinates with network
    sections. Nothing is extracted to disk and no coordinate, timestamp,
    contributor, ordering or journey is retained."""
    stats: dict[str, int] = defaultdict(int)
    marks: dict[tuple[int, int], set[int]] = defaultdict(set)
    lat_prefixes, lon_prefixes = prefilter_prefixes(bounds_wgs84)
    total_bytes = archive.stat().st_size
    started = time.monotonic()
    reported = started
    members = 0
    context = get_context("fork")

    def merge(result: tuple[list[tuple[int, int, int]], dict[str, int]]) -> None:
        produced, counters = result
        for way_id, section_index, mode in produced:
            marks[(way_id, section_index)].add(mode)
        for key, value in counters.items():
            stats[key] += value

    with archive.open("rb") as raw:
        hashing = HashingReader(raw)
        with ProcessPoolExecutor(max_workers=workers, mp_context=context) as executor:
            pending: set = set()
            # "r|*" rather than "r|xz": a tiled build reads the uncompressed
            # intermediate that prefilter_gps.py writes, and the original archive
            # still opens through the same call.
            with tarfile.open(fileobj=hashing, mode="r|*") as tar:
                for member in tar:
                    if not member.isfile():
                        continue
                    visibility = member.name.split("/")[1] if "/" in member.name else "unknown"
                    if not member.name.lower().endswith(".gpx"):
                        continue
                    members += 1
                    stats[f"members_{visibility}"] += 1
                    extracted = tar.extractfile(member)
                    if extracted is None:
                        continue
                    data = extracted.read()
                    if use_prefilter and not member_passes(data, lat_prefixes, lon_prefixes):
                        stats["members_prefiltered_out"] += 1
                    else:
                        stats["members_scanned"] += 1
                        if len(pending) >= workers * 4:
                            done, pending = wait(pending, return_when=FIRST_COMPLETED)
                            for future in done:
                                merge(future.result())
                        pending.add(executor.submit(match_member, data))

                    now = time.monotonic()
                    if now - reported >= 30:
                        reported = now
                        share = hashing.bytes_read / total_bytes
                        elapsed = now - started
                        remaining = elapsed / share - elapsed if share > 0 else 0
                        print(
                            f"  [{format_duration(elapsed)}] {share * 100:5.1f}%"
                            f" · {hashing.bytes_read / 1e9:5.1f}/{total_bytes / 1e9:.1f} GB"
                            f" · {members:,} members"
                            f" · {stats['members_scanned']:,} in the region's bands"
                            f" · {stats['accepted']:,} coordinates matched"
                            f" · about {format_duration(remaining)} left",
                            flush=True,
                        )
                    if member_limit is not None and members >= member_limit:
                        break
            for future in pending:
                merge(future.result())
        if member_limit is None:
            for _ in iter(lambda: hashing.read(1024 * 1024), b""):
                pass
    stats["gps_members_total"] = members
    print(
        f"  [{format_duration(time.monotonic() - started)}] finished the archive:"
        f" {members:,} members, {stats['accepted']:,} coordinates matched",
        flush=True,
    )
    # A limited spike intentionally reports the checksum of only bytes consumed.
    return dict(stats), marks, hashing.sha256.hexdigest(), hashing.md5.hexdigest()


def context_sections(
    ways: list[NetworkWay], green: list, water: list
) -> dict[tuple[int, int], set[str]]:
    """Marks each section whose midpoint lies near recorded greenspace or water.
    Midpoints rather than whole sections, so the entire network can be tested in
    two vectorised queries rather than 1.7 million individual ones."""
    if not green and not water:
        return {}
    keys: list[tuple[int, int]] = []
    midpoints: list = []
    for way in ways:
        for section_index in range(way.section_count):
            start = section_index * SECTION_LENGTH_M
            end = min(way.length_m, start + SECTION_LENGTH_M)
            keys.append((way.way_id, section_index))
            midpoints.append(way.line_projected.interpolate((start + end) / 2))
    points = np.asarray(midpoints, dtype=object)
    found: dict[tuple[int, int], set[str]] = defaultdict(set)
    for source, geometries, distance in (
        ("near_green", green, GREEN_PROXIMITY_M),
        ("near_water", water, WATER_PROXIMITY_M),
    ):
        if not geometries:
            continue
        tree = STRtree(geometries)
        point_index, _ = tree.query(points, predicate="dwithin", distance=distance)
        for which in np.unique(point_index):
            found[keys[int(which)]].add(source)
    return found


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
    database.executescript(SCHEMA_SQL)
    database.executemany("INSERT INTO metadata(key, value) VALUES (?, ?)", metadata.items())
    database.executemany(
        "INSERT INTO evidence_source VALUES (?, ?, ?, ?, ?, ?)", SOURCE_ROWS
    )
    section_pk = 0
    for (way_id, section_index), sources in sorted(evidence.items()):
        way = ways.get(way_id)
        if way is None or not sources:
            continue
        start_m = section_index * SECTION_LENGTH_M
        end_m = min(way.length_m, start_m + SECTION_LENGTH_M)
        # Preserve the exact unsimplified 25 m network substring. Runtime route
        # overlaps are derived separately and must never replace this geometry.
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
    parser.add_argument(
        "--workers",
        type=int,
        default=max(1, (os.cpu_count() or 2) - 2),
        help="Processes matching GPX members against the network.",
    )
    parser.add_argument(
        "--no-prefilter",
        action="store_true",
        help="Parse every archive member instead of only those whose bytes could hold an in-region coordinate.",
    )
    parser.add_argument(
        "--own-bbox",
        help=(
            "west,south,east,north of the cell this tile is responsible for."
            " The PBF should extend beyond it: ways outside the cell are still"
            " loaded, so coordinates near its edge are matched against the same"
            " neighbourhood a whole-region build would see, but only ways whose"
            " midpoint falls inside the cell are written. Without this a tiled"
            " build can attribute a coordinate to the wrong way at tile edges,"
            " because the truly nearest way was cut away."
        ),
    )
    parser.add_argument(
        "--gps-provenance",
        type=Path,
        help=(
            "Provenance JSON from prefilter_gps.py. When --gps-archive is a prefiltered"
            " intermediate, this carries the original archive's checksums and member"
            " counts into the output so the database still records what it came from."
        ),
    )
    args = parser.parse_args()
    started = time.monotonic()
    to_projected = Transformer.from_crs(4326, 27700, always_xy=True)
    to_wgs84 = Transformer.from_crs(27700, 4326, always_xy=True)

    print("Reading current highway network, status tags and route relations…", flush=True)
    handler = NetworkHandler(to_projected)
    handler.apply_file(str(args.pbf), locations=True, idx="flex_mem")
    ways = handler.ways
    if not ways:
        raise SystemExit("The regional PBF contains no usable highway geometries.")
    print(f"  {len(ways):,} highway ways, {len(handler.way_sources):,} way-level source marks", flush=True)

    print("Reading recorded greenspace and water…", flush=True)
    green, water = read_context_geometries(args.pbf, to_projected)
    print(f"  {len(green):,} greenspace and {len(water):,} water features", flush=True)

    evidence: dict[tuple[int, int], dict[str, str | None]] = defaultdict(dict)
    for (way_id, source), reference in handler.way_sources.items():
        way = ways.get(way_id)
        if way is None:
            continue
        for section_index in range(way.section_count):
            evidence[(way_id, section_index)].setdefault(source, reference)

    print("Marking sections near recorded greenspace and water…", flush=True)
    for key, sources in context_sections(list(ways.values()), green, water).items():
        for source in sources:
            evidence[key].setdefault(source, None)

    way_list = list(ways.values())
    way_bounds = [way.line_projected.bounds for way in way_list]
    min_x = min(bounds[0] for bounds in way_bounds)
    min_y = min(bounds[1] for bounds in way_bounds)
    max_x = max(bounds[2] for bounds in way_bounds)
    max_y = max(bounds[3] for bounds in way_bounds)
    west, south = to_wgs84.transform(min_x - REGION_MARGIN_M, min_y - REGION_MARGIN_M)
    east, north = to_wgs84.transform(max_x + REGION_MARGIN_M, max_y + REGION_MARGIN_M)
    bounds_wgs84 = (west, south, east, north)

    geometries = np.asarray([way.line_projected for way in way_list], dtype=object)
    WORKER.update(
        to_projected=to_projected,
        tree=STRtree(list(geometries)),
        geometries=geometries,
        way_ids=np.asarray([way.way_id for way in way_list], dtype=np.int64),
        verticals=[way.vertical for way in way_list],
        section_counts=np.asarray([way.section_count for way in way_list], dtype=np.int64),
        bounds=bounds_wgs84,
    )

    workers = max(1, args.workers)
    print(
        f"Streaming compressed GPX members without extracting them"
        f" ({workers} matching workers, prefilter {'off' if args.no_prefilter else 'on'})…",
        flush=True,
    )
    gps_stats, marks, gps_sha256, gps_md5 = stream_gps(
        args.gps_archive,
        bounds_wgs84,
        args.gps_member_limit,
        workers,
        not args.no_prefilter,
    )
    for (way_id, section_index), modes in marks.items():
        if way_id not in ways:
            continue
        for mode in modes:
            evidence[(way_id, section_index)].setdefault(MODE_SOURCES[mode], None)

    prefiltered = False
    if args.gps_provenance:
        # The intermediate's own digest would say nothing anybody can check, so
        # record the digests of the archive it was distilled from. Its
        # whole-archive member counts replace the intermediate's too, which
        # otherwise only describe what survived the first pass.
        provenance = json.loads(args.gps_provenance.read_text(encoding="utf-8"))
        gps_sha256 = provenance["sourceSha256"]
        gps_md5 = provenance["sourceMd5"]
        prefiltered = True
        for key in ("gps_members_total", "members_public", "members_trackable",
                    "members_identifiable", "members_unknown"):
            if key in provenance:
                gps_stats[key] = provenance[key]
        gps_stats["members_prefiltered_out"] = (
            provenance.get("members_prefiltered_out", 0)
            + gps_stats.get("members_prefiltered_out", 0)
        )

    if args.own_bbox:
        values = [float(value) for value in args.own_bbox.split(",")]
        if len(values) != 4 or values[0] >= values[2] or values[1] >= values[3]:
            raise SystemExit("--own-bbox must be west,south,east,north")
        own_west, own_south, own_east, own_north = values
        # Half-open on the maximum edges so neighbouring cells partition the
        # region: every way is owned by exactly one tile, never zero or two.
        owned = set()
        for way in way_list:
            point = way.line_projected.interpolate(0.5, normalized=True)
            lon, lat = to_wgs84.transform(point.x, point.y)
            if own_west <= lon < own_east and own_south <= lat < own_north:
                owned.add(way.way_id)
        before = len(evidence)
        evidence = {key: value for key, value in evidence.items() if key[0] in owned}
        ways = {way_id: way for way_id, way in ways.items() if way_id in owned}
        print(
            f"Cell owns {len(owned):,} of {len(way_list):,} ways;"
            f" {before - len(evidence):,} evidenced sections belong to neighbouring tiles",
            flush=True,
        )

    pbf_sha256 = sha256_file(args.pbf)
    built_at = datetime.now(timezone.utc).isoformat()
    metadata = {
        "osm_pbf_sha256": pbf_sha256,
        "gps_archive_sha256": gps_sha256,
        "gps_archive_md5": gps_md5,
        "gps_archive_complete": str(args.gps_member_limit is None).lower(),
        "gps_archive_prefiltered": str(prefiltered).lower(),
        "built_at": built_at,
        "section_length_m": str(SECTION_LENGTH_M),
        "green_proximity_m": str(GREEN_PROXIMITY_M),
        "water_proximity_m": str(WATER_PROXIMITY_M),
        "source_and_licence_summary": "Current OSM network, tags and route relations: ODbL 1.0; 2013 OSM GPS archive: CC BY-SA 2.0. Local prototype output; review licensing before redistribution.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    print("Writing the evidence database…", flush=True)
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
    use_sources = {source for source, kind, *_ in SOURCE_ROWS if kind == "use"}
    any_use_length = sum(
        min(SECTION_LENGTH_M, ways[way_id].length_m - index * SECTION_LENGTH_M)
        for (way_id, index), sources in evidence.items()
        if way_id in ways and use_sources & sources.keys()
    )
    report = {
        "builtAt": built_at,
        "limitedGpsMemberSpike": args.gps_member_limit is not None,
        "archiveSha256": gps_sha256,
        "archiveMd5": gps_md5,
        "processingSeconds": round(time.monotonic() - started, 2),
        "workers": workers,
        "prefilterEnabled": not args.no_prefilter,
        "gpsArchivePrefiltered": prefiltered,
        **gps_stats,
        "rejected_associations": sum(
            gps_stats.get(key, 0)
            for key in ("rejected_distance", "rejected_ambiguity", "rejected_vertical_structure")
        ),
        "network_sections": network_sections,
        "network_length_m": round(network_length, 2),
        "stored_sections": len(evidence),
        "evidenced_sections_by_source": source_sections,
        "evidenced_length_m_by_source": source_lengths,
        "any_use_evidence_distance_pct": round(100 * any_use_length / network_length, 3),
        "output_database_bytes": args.output.stat().st_size,
    }
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    main()
