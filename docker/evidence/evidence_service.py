#!/usr/bin/env python3
"""Private HTTP service for the immutable route-use evidence database."""

from __future__ import annotations

import hashlib
import json
import math
import os
import sqlite3
import threading
import time
from collections import OrderedDict, defaultdict
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn
from urllib.parse import parse_qs, urlparse

import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import LineString, mapping

DATABASE_PATH = Path(os.environ.get("EVIDENCE_DATABASE", "/evidence/route-use-evidence.sqlite"))
PBF_PATH = Path(os.environ.get("OSM_PBF", "/data/local-region.osm.pbf"))
PORT = int(os.environ.get("EVIDENCE_PORT", "8003"))
MAX_BODY_BYTES = 10 * 1024 * 1024
MAX_BATCH_ROUTES = 6
MAX_VIEWPORT_SECTIONS = 5_000
MAX_WORKERS = 6
GEOMETRY_CACHE_BYTES = 128 * 1024 * 1024
TO_PROJECTED = Transformer.from_crs(4326, 27700, always_xy=True)
TO_WGS84 = Transformer.from_crs(27700, 4326, always_xy=True)
THREAD_STATE = threading.local()


class RequestError(ValueError):
    def __init__(self, message: str, code: str = "invalid_request", status: int = 400, **details: object):
        super().__init__(message)
        self.code = code
        self.status = status
        self.details = details
        self.sql_ms = 0.0
        self.geometry_ms = 0.0


class GeometryCache:
    """A byte-accounted LRU shared by the bounded request workers."""

    def __init__(self, limit_bytes: int):
        self.limit_bytes = limit_bytes
        self.size_bytes = 0
        self._values: OrderedDict[str, tuple[object, object, int]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> tuple[object, object] | None:
        with self._lock:
            value = self._values.get(key)
            if value is None:
                return None
            self._values.move_to_end(key)
            return value[0], value[1]

    def put(self, key: str, projected: object, buffered: object, size_bytes: int) -> None:
        if size_bytes > self.limit_bytes:
            return
        with self._lock:
            previous = self._values.pop(key, None)
            if previous:
                self.size_bytes -= previous[2]
            while self._values and self.size_bytes + size_bytes > self.limit_bytes:
                _, evicted = self._values.popitem(last=False)
                self.size_bytes -= evicted[2]
            self._values[key] = (projected, buffered, size_bytes)
            self.size_bytes += size_bytes


GEOMETRY_CACHE = GeometryCache(GEOMETRY_CACHE_BYTES)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def connect() -> sqlite3.Connection:
    uri = f"file:{DATABASE_PATH}?mode=ro&immutable=1"
    database = sqlite3.connect(uri, uri=True)
    database.row_factory = sqlite3.Row
    return database


def worker_database() -> sqlite3.Connection:
    database = getattr(THREAD_STATE, "database", None)
    if database is None:
        database = connect()
        THREAD_STATE.database = database
    return database


def load_startup_state() -> tuple[dict[str, str], list[dict[str, str]]]:
    if not DATABASE_PATH.is_file() or not PBF_PATH.is_file():
        raise SystemExit("Evidence database and current regional PBF must both be mounted read-only.")
    with connect() as database:
        metadata = {row["key"]: row["value"] for row in database.execute("SELECT key, value FROM metadata")}
        sources = [dict(row) for row in database.execute("SELECT * FROM evidence_source ORDER BY source_id")]
    expected = metadata.get("osm_pbf_sha256")
    actual = sha256_file(PBF_PATH)
    if not expected or expected != actual:
        raise SystemExit(
            f"Evidence database is stale: mounted PBF SHA-256 is {actual}, database expects {expected or 'nothing'}."
        )
    if metadata.get("gps_archive_complete") != "true":
        raise SystemExit("Evidence database was produced by limited streaming-spike mode, not a complete archive pass.")
    return metadata, sources


METADATA, SOURCES = load_startup_state()
SOURCE_BY_ID = {source["source_id"]: source for source in SOURCES}


def validate_sources(value: object) -> list[str]:
    requested = value or []
    if not isinstance(requested, list) or not all(isinstance(source, str) for source in requested):
        raise RequestError("sources must be an array of source identifiers")
    unknown = sorted(set(requested) - SOURCE_BY_ID.keys())
    if unknown:
        raise RequestError(f"Unknown evidence sources: {', '.join(unknown)}", "unknown_sources")
    return sorted(set(requested))


def section_rows_for_ways(
    database: sqlite3.Connection, way_ids: set[int], selected_sources: list[str]
) -> dict[int, dict[str, dict]]:
    if not way_ids:
        return {}
    parameters: list[object] = [json.dumps(sorted(way_ids))]
    source_clause = ""
    if selected_sources:
        source_clause = " AND se.source_id IN (SELECT value FROM json_each(?))"
        parameters.append(json.dumps(selected_sources))
    rows = database.execute(
        f"""
        SELECT ns.section_id, ns.way_id, ns.section_index, ns.geometry_wkb,
               se.source_id, se.feature_reference
        FROM network_section ns
        JOIN section_evidence se ON se.section_id = ns.section_id
        WHERE ns.way_id IN (SELECT value FROM json_each(?)) {source_clause}
        ORDER BY ns.way_id, ns.section_index, se.source_id
        """,
        parameters,
    ).fetchall()
    grouped: dict[int, dict[str, dict]] = defaultdict(dict)
    for row in rows:
        section = grouped[row["way_id"]].setdefault(
            row["section_id"],
            {
                "section_id": row["section_id"],
                "geometry_wkb": bytes(row["geometry_wkb"]),
                "sources": [],
                "references": {},
            },
        )
        section["sources"].append(row["source_id"])
        if row["feature_reference"]:
            section["references"][row["source_id"]] = row["feature_reference"]
    return grouped


def _project_coordinates(coordinates: np.ndarray) -> np.ndarray:
    x, y = TO_PROJECTED.transform(coordinates[:, 0], coordinates[:, 1])
    return np.column_stack((x, y))


def _wgs84_coordinates(coordinates: np.ndarray) -> np.ndarray:
    lon, lat = TO_WGS84.transform(coordinates[:, 0], coordinates[:, 1])
    return np.column_stack((lon, lat))


def cached_section_geometry(sections_by_way: dict[int, dict[str, dict]]) -> None:
    missing: list[dict] = []
    for sections in sections_by_way.values():
        for section in sections.values():
            cached = GEOMETRY_CACHE.get(section["section_id"])
            if cached:
                section["projected"], section["buffered"] = cached
            else:
                missing.append(section)
    if not missing:
        return
    decoded = shapely.from_wkb(np.asarray([section["geometry_wkb"] for section in missing], dtype=object))
    projected = shapely.transform(decoded, _project_coordinates)
    buffered = shapely.buffer(projected, 2.5, cap_style="flat")
    shapely.prepare(buffered)
    coordinate_counts = shapely.get_num_coordinates(projected) + shapely.get_num_coordinates(buffered)
    for section, line, area, coordinate_count in zip(missing, projected, buffered, coordinate_counts):
        section["projected"] = line
        section["buffered"] = area
        size = int(coordinate_count) * 16 + len(section["geometry_wkb"]) + 512
        GEOMETRY_CACHE.put(section["section_id"], line, area, size)


def viewport_features(
    bounds: tuple[float, float, float, float], selected_source: str | None
) -> tuple[list[dict], float, float]:
    started_sql = time.perf_counter()
    west, south, east, north = bounds
    parameters: list[object] = [east, west, north, south]
    picked_clause = ""
    evidence_clause = ""
    if selected_source:
        picked_clause = """
          AND EXISTS (
            SELECT 1 FROM section_evidence picked
            WHERE picked.section_id = ns.section_id AND picked.source_id = ?
          )
        """
        evidence_clause = "WHERE se.source_id = ?"
        parameters.extend((selected_source, selected_source))
    rows = worker_database().execute(
        f"""
        WITH picked_sections AS (
          SELECT ns.section_id, ns.way_id, ns.section_index, ns.geometry_wkb
          FROM network_section_rtree tree
          JOIN network_section ns ON ns.section_pk = tree.section_pk
          WHERE tree.min_lon <= ? AND tree.max_lon >= ?
            AND tree.min_lat <= ? AND tree.max_lat >= ? {picked_clause}
          ORDER BY ns.way_id, ns.section_index
          LIMIT {MAX_VIEWPORT_SECTIONS + 1}
        )
        SELECT picked.section_id, picked.way_id, picked.section_index, picked.geometry_wkb,
               se.source_id, se.feature_reference, es.label
        FROM picked_sections picked
        JOIN section_evidence se ON se.section_id = picked.section_id
        JOIN evidence_source es ON es.source_id = se.source_id
        {evidence_clause}
        ORDER BY picked.way_id, picked.section_index, se.source_id
        """,
        parameters,
    ).fetchall()
    sql_ms = (time.perf_counter() - started_sql) * 1000
    grouped: OrderedDict[str, dict] = OrderedDict()
    for row in rows:
        section = grouped.setdefault(
            row["section_id"],
            {
                "wayId": row["way_id"],
                "sectionId": row["section_id"],
                "geometry_wkb": bytes(row["geometry_wkb"]),
                "sources": [],
                "sourceLabels": [],
                "featureReferences": {},
            },
        )
        section["sources"].append(row["source_id"])
        section["sourceLabels"].append(row["label"])
        if row["feature_reference"]:
            section["featureReferences"][row["source_id"]] = row["feature_reference"]
    if len(grouped) > MAX_VIEWPORT_SECTIONS:
        error = RequestError(
            "The viewport contains more than 5,000 evidence sections. Zoom in to load it.",
            "viewport_too_broad",
            413,
            limit=MAX_VIEWPORT_SECTIONS,
        )
        error.sql_ms = sql_ms
        raise error
    started_geometry = time.perf_counter()
    sections = list(grouped.values())
    geometries = shapely.from_wkb(
        np.asarray([section.pop("geometry_wkb") for section in sections], dtype=object)
    )
    features = [
        {"type": "Feature", "properties": section, "geometry": mapping(geometry)}
        for section, geometry in zip(sections, geometries)
    ]
    return features, sql_ms, (time.perf_counter() - started_geometry) * 1000


def parse_edges(raw_edges: object) -> tuple[list[dict], set[int]]:
    if not isinstance(raw_edges, list):
        raise RequestError("edges must be an array")
    edges: list[dict] = []
    way_ids: set[int] = set()
    for raw_edge in raw_edges:
        if not isinstance(raw_edge, dict):
            continue
        coordinates = raw_edge.get("coordinates")
        if (
            not isinstance(coordinates, list)
            or len(coordinates) < 2
            or not all(isinstance(point, list) and len(point) >= 2 for point in coordinates)
        ):
            continue
        try:
            parsed_coordinates = [(float(point[0]), float(point[1])) for point in coordinates]
        except (TypeError, ValueError):
            continue
        if not all(math.isfinite(lon) and math.isfinite(lat) for lon, lat in parsed_coordinates):
            continue
        line = LineString(parsed_coordinates)
        raw_way_id = raw_edge.get("wayId")
        way_id = int(raw_way_id) if isinstance(raw_way_id, (int, float)) else None
        if way_id is not None:
            way_ids.add(way_id)
        edges.append({"way_id": way_id, "wgs84": line})
    return edges, way_ids


def evidence_response(
    route_distance: float, evidenced_distance: float, features: list[dict], include_segments: bool
) -> dict:
    fraction = min(1.0, evidenced_distance / route_distance) if route_distance else 0.0
    response = {
        "routeDistanceM": round(route_distance, 3),
        "evidencedDistanceM": round(evidenced_distance, 3),
        "evidencedFraction": round(fraction, 6),
    }
    if include_segments:
        response["segments"] = {"type": "FeatureCollection", "features": features}
    return response


def calculate_route_evidence(
    edges: list[dict], sections_by_way: dict[int, dict[str, dict]], include_segments: bool
) -> dict:
    if not edges:
        return evidence_response(0.0, 0.0, [], include_segments)
    projected_edges = shapely.transform(
        np.asarray([edge["wgs84"] for edge in edges], dtype=object), _project_coordinates
    )
    route_distance = float(np.sum(shapely.length(projected_edges)))
    edges_by_way: dict[int, list[object]] = defaultdict(list)
    for edge, projected in zip(edges, projected_edges):
        if edge["way_id"] is not None:
            edges_by_way[edge["way_id"]].append(projected)
    evidenced_distance = 0.0
    features: list[dict] = []
    for way_id, way_edges in edges_by_way.items():
        sections = list(sections_by_way.get(way_id, {}).values())
        if not sections:
            continue
        edge_geometries = np.asarray(way_edges, dtype=object)
        buffers = np.asarray([section["buffered"] for section in sections], dtype=object)
        overlaps = shapely.intersection(edge_geometries[:, np.newaxis], buffers[np.newaxis, :])
        useful_mask = (~shapely.is_empty(overlaps)) & (shapely.length(overlaps) > 0.01)
        for row, mask in zip(overlaps, useful_mask):
            useful = row[mask]
            if len(useful):
                # Union per supplied edge so a separately supplied repeated traversal counts again.
                evidenced_distance += float(shapely.length(shapely.unary_union(useful)))
        if include_segments:
            useful_indexes = np.argwhere(useful_mask)
            if len(useful_indexes):
                useful_projected = np.asarray(
                    [overlaps[edge_index, section_index] for edge_index, section_index in useful_indexes],
                    dtype=object,
                )
                useful_wgs84 = shapely.transform(useful_projected, _wgs84_coordinates)
                for (_, section_index), overlap in zip(useful_indexes, useful_wgs84):
                    section = sections[int(section_index)]
                    features.append(
                        {
                            "type": "Feature",
                            "properties": {
                                "wayId": way_id,
                                "sectionId": section["section_id"],
                                "evidenced": True,
                                "sources": section["sources"],
                                "sourceLabels": [SOURCE_BY_ID[source]["label"] for source in section["sources"]],
                                "featureReferences": section["references"],
                            },
                            "geometry": mapping(overlap),
                        }
                    )
    return evidence_response(route_distance, evidenced_distance, features, include_segments)


def route_evidence(payload: dict) -> tuple[dict, float, float]:
    requested_sources = validate_sources(payload.get("sources"))
    include_segments = payload.get("includeSegments", True)
    if not isinstance(include_segments, bool):
        raise RequestError("includeSegments must be a Boolean")
    started_geometry = time.perf_counter()
    edges, way_ids = parse_edges(payload.get("edges"))
    parse_ms = (time.perf_counter() - started_geometry) * 1000
    started_sql = time.perf_counter()
    sections_by_way = section_rows_for_ways(worker_database(), way_ids, requested_sources)
    sql_ms = (time.perf_counter() - started_sql) * 1000
    started_geometry = time.perf_counter()
    cached_section_geometry(sections_by_way)
    result = calculate_route_evidence(edges, sections_by_way, include_segments)
    return result, sql_ms, parse_ms + (time.perf_counter() - started_geometry) * 1000


def batch_route_evidence(payload: dict) -> tuple[dict, float, float]:
    routes = payload.get("routes")
    if not isinstance(routes, list):
        raise RequestError("routes must be an array")
    if not routes or len(routes) > MAX_BATCH_ROUTES:
        raise RequestError(
            "routes must contain between one and six identified routes",
            "batch_size_exceeded" if len(routes) > MAX_BATCH_ROUTES else "invalid_request",
            limit=MAX_BATCH_ROUTES,
        )
    requested_sources = validate_sources(payload.get("sources"))
    include_segments = payload.get("includeSegments", False)
    if not isinstance(include_segments, bool):
        raise RequestError("includeSegments must be a Boolean")
    parsed_routes: list[tuple[object, list[dict]]] = []
    identifiers: set[object] = set()
    way_ids: set[int] = set()
    started_geometry = time.perf_counter()
    for route in routes:
        if not isinstance(route, dict) or not isinstance(route.get("id"), (str, int)):
            raise RequestError("Each batch route must have a string or integer id")
        identifier = route["id"]
        if identifier in identifiers:
            raise RequestError("Batch route ids must be unique")
        identifiers.add(identifier)
        edges, route_way_ids = parse_edges(route.get("edges"))
        parsed_routes.append((identifier, edges))
        way_ids.update(route_way_ids)
    parse_ms = (time.perf_counter() - started_geometry) * 1000
    started_sql = time.perf_counter()
    sections_by_way = section_rows_for_ways(worker_database(), way_ids, requested_sources)
    sql_ms = (time.perf_counter() - started_sql) * 1000
    started_geometry = time.perf_counter()
    cached_section_geometry(sections_by_way)
    results = [
        {"id": identifier, **calculate_route_evidence(edges, sections_by_way, include_segments)}
        for identifier, edges in parsed_routes
    ]
    return {"routes": results}, sql_ms, parse_ms + (time.perf_counter() - started_geometry) * 1000


class Handler(BaseHTTPRequestHandler):
    server_version = "OpenLooperEvidence/0.2"

    def send_json(self, status: int, data: dict) -> float:
        started = time.perf_counter()
        encoded = json.dumps(data, separators=(",", ":")).encode()
        serialization_ms = (time.perf_counter() - started) * 1000
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(encoded)
        except (BrokenPipeError, ConnectionResetError):
            pass
        return serialization_ms

    def send_error_json(self, error: Exception) -> tuple[int, float]:
        if isinstance(error, RequestError):
            status = error.status
            body = {"error": str(error), "code": error.code, **error.details}
        else:
            status = 400
            body = {"error": str(error), "code": "invalid_request"}
        return status, self.send_json(status, body)

    def read_payload(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise RequestError("Content-Length must be an integer") from error
        if length <= 0 or length > MAX_BODY_BYTES:
            raise RequestError(
                "Request body is missing or too large",
                "body_too_large" if length > MAX_BODY_BYTES else "invalid_request",
                413 if length > MAX_BODY_BYTES else 400,
                limitBytes=MAX_BODY_BYTES,
            )
        try:
            payload = json.loads(self.rfile.read(length))
        except json.JSONDecodeError as error:
            raise RequestError("Request body is not valid JSON", "invalid_json") from error
        if not isinstance(payload, dict):
            raise RequestError("Request body must be an object")
        return payload

    def log_timing(
        self, endpoint: str, status: int, started: float, sql_ms: float, geometry_ms: float, serialization_ms: float
    ) -> None:
        print(
            json.dumps(
                {
                    "endpoint": endpoint,
                    "status": status,
                    "totalMs": round((time.perf_counter() - started) * 1000, 3),
                    "sqlMs": round(sql_ms, 3),
                    "geometryMs": round(geometry_ms, 3),
                    "serializationMs": round(serialization_ms, 3),
                },
                separators=(",", ":"),
            ),
            flush=True,
        )

    def do_GET(self) -> None:
        started = time.perf_counter()
        parsed = urlparse(self.path)
        sql_ms = geometry_ms = 0.0
        status = 200
        try:
            if parsed.path == "/status":
                serialization_ms = self.send_json(
                    200,
                    {"ready": True, "metadata": METADATA, "pbfChecksum": METADATA["osm_pbf_sha256"], "sources": SOURCES},
                )
            elif parsed.path == "/evidence/sections":
                query = parse_qs(parsed.query)
                values = [float(value) for value in query.get("bbox", [""])[0].split(",")]
                if len(values) != 4 or values[0] >= values[2] or values[1] >= values[3]:
                    raise RequestError("bbox must be west,south,east,north")
                source = query.get("source", [None])[0]
                if source and source not in SOURCE_BY_ID:
                    raise RequestError(f"Unknown evidence source: {source}", "unknown_sources")
                features, sql_ms, geometry_ms = viewport_features(tuple(values), source)
                serialization_ms = self.send_json(200, {"type": "FeatureCollection", "features": features})
            else:
                status = 404
                serialization_ms = self.send_json(404, {"error": "Not found", "code": "not_found"})
        except (RequestError, ValueError, sqlite3.Error) as error:
            sql_ms = getattr(error, "sql_ms", sql_ms)
            geometry_ms = getattr(error, "geometry_ms", geometry_ms)
            status, serialization_ms = self.send_error_json(error)
        self.log_timing(parsed.path, status, started, sql_ms, geometry_ms, serialization_ms)

    def do_POST(self) -> None:
        started = time.perf_counter()
        endpoint = urlparse(self.path).path
        sql_ms = geometry_ms = 0.0
        status = 200
        try:
            if endpoint not in ("/route-evidence", "/route-evidence/batch"):
                status = 404
                serialization_ms = self.send_json(404, {"error": "Not found", "code": "not_found"})
            else:
                payload = self.read_payload()
                if endpoint == "/route-evidence":
                    response, sql_ms, geometry_ms = route_evidence(payload)
                else:
                    response, sql_ms, geometry_ms = batch_route_evidence(payload)
                serialization_ms = self.send_json(200, response)
        except (RequestError, ValueError, json.JSONDecodeError, sqlite3.Error) as error:
            sql_ms = getattr(error, "sql_ms", sql_ms)
            geometry_ms = getattr(error, "geometry_ms", geometry_ms)
            status, serialization_ms = self.send_error_json(error)
        self.log_timing(endpoint, status, started, sql_ms, geometry_ms, serialization_ms)

    def log_message(self, message: str, *args: object) -> None:
        pass


class BoundedHTTPServer(ThreadingMixIn, HTTPServer):
    """Serve every request on the same six reusable worker threads."""

    daemon_threads = True
    block_on_close = True

    def __init__(self, server_address: tuple[str, int], handler: type[BaseHTTPRequestHandler]):
        super().__init__(server_address, handler)
        self.executor = ThreadPoolExecutor(max_workers=MAX_WORKERS, thread_name_prefix="evidence")

    def process_request(self, request: object, client_address: object) -> None:
        self.executor.submit(self.process_request_thread, request, client_address)

    def server_close(self) -> None:
        super().server_close()
        self.executor.shutdown(wait=True, cancel_futures=True)


if __name__ == "__main__":
    print(
        f"Evidence database ready for PBF {METADATA['osm_pbf_sha256']}; listening on {PORT} with {MAX_WORKERS} workers",
        flush=True,
    )
    BoundedHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
