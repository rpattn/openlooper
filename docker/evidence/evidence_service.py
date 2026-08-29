#!/usr/bin/env python3
"""Private HTTP service for the route-use evidence SQLite database."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from pyproj import Transformer
from shapely import wkb
from shapely.geometry import LineString, mapping
from shapely.ops import transform, unary_union

DATABASE_PATH = Path(os.environ.get("EVIDENCE_DATABASE", "/evidence/route-use-evidence.sqlite"))
PBF_PATH = Path(os.environ.get("OSM_PBF", "/data/local-region.osm.pbf"))
PORT = int(os.environ.get("EVIDENCE_PORT", "8003"))
TO_PROJECTED = Transformer.from_crs(4326, 27700, always_xy=True)
TO_WGS84 = Transformer.from_crs(27700, 4326, always_xy=True)


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


def section_rows_for_ways(
    database: sqlite3.Connection, way_ids: list[int], selected_sources: list[str]
) -> dict[int, dict[str, dict]]:
    if not way_ids:
        return {}
    way_placeholders = ",".join("?" for _ in way_ids)
    parameters: list[object] = list(way_ids)
    source_clause = ""
    if selected_sources:
        source_placeholders = ",".join("?" for _ in selected_sources)
        source_clause = f" AND se.source_id IN ({source_placeholders})"
        parameters.extend(selected_sources)
    rows = database.execute(
        f"""
        SELECT ns.section_id, ns.way_id, ns.geometry_wkb,
               se.source_id, se.feature_reference
        FROM network_section ns
        JOIN section_evidence se ON se.section_id = ns.section_id
        WHERE ns.way_id IN ({way_placeholders}) {source_clause}
        ORDER BY ns.way_id, ns.section_index, se.source_id
        """,
        parameters,
    )
    grouped: dict[int, dict[str, dict]] = defaultdict(dict)
    for row in rows:
        section = grouped[row["way_id"]].setdefault(
            row["section_id"],
            {
                "geometry": wkb.loads(row["geometry_wkb"]),
                "sources": [],
                "references": {},
            },
        )
        section["sources"].append(row["source_id"])
        if row["feature_reference"]:
            section["references"][row["source_id"]] = row["feature_reference"]
    return grouped


def viewport_features(
    bounds: tuple[float, float, float, float], selected_source: str | None
) -> list[dict]:
    west, south, east, north = bounds
    parameters: list[object] = [east, west, north, south]
    source_clause = ""
    if selected_source:
        source_clause = " AND EXISTS (SELECT 1 FROM section_evidence picked WHERE picked.section_id = ns.section_id AND picked.source_id = ?)"
        parameters.append(selected_source)
    with connect() as database:
        sections = database.execute(
            f"""
            SELECT ns.section_id, ns.way_id, ns.geometry_wkb
            FROM network_section_rtree tree
            JOIN network_section ns ON ns.section_pk = tree.section_pk
            WHERE tree.min_lon <= ? AND tree.max_lon >= ?
              AND tree.min_lat <= ? AND tree.max_lat >= ? {source_clause}
            ORDER BY ns.way_id, ns.section_index
            """,
            parameters,
        ).fetchall()
        features = []
        for section in sections:
            evidence_rows = database.execute(
                """
                SELECT se.source_id, se.feature_reference, es.label
                FROM section_evidence se
                JOIN evidence_source es ON es.source_id = se.source_id
                WHERE se.section_id = ?
                ORDER BY se.source_id
                """,
                (section["section_id"],),
            ).fetchall()
            if selected_source:
                evidence_rows = [row for row in evidence_rows if row["source_id"] == selected_source]
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "wayId": section["way_id"],
                        "sectionId": section["section_id"],
                        "sources": [row["source_id"] for row in evidence_rows],
                        "sourceLabels": [row["label"] for row in evidence_rows],
                        "featureReferences": {
                            row["source_id"]: row["feature_reference"]
                            for row in evidence_rows
                            if row["feature_reference"]
                        },
                    },
                    "geometry": mapping(wkb.loads(section["geometry_wkb"])),
                }
            )
        return features


def route_evidence(payload: dict) -> dict:
    raw_edges = payload.get("edges")
    if not isinstance(raw_edges, list):
        raise ValueError("edges must be an array")
    requested_sources = payload.get("sources") or []
    if not isinstance(requested_sources, list) or not all(isinstance(value, str) for value in requested_sources):
        raise ValueError("sources must be an array of source identifiers")
    unknown_sources = sorted(set(requested_sources) - SOURCE_BY_ID.keys())
    if unknown_sources:
        raise ValueError(f"Unknown evidence sources: {', '.join(unknown_sources)}")
    way_ids = sorted(
        {
            int(edge["wayId"])
            for edge in raw_edges
            if isinstance(edge, dict) and isinstance(edge.get("wayId"), (int, float))
        }
    )
    with connect() as database:
        sections_by_way = section_rows_for_ways(database, way_ids, requested_sources)
    route_distance = 0.0
    evidenced_distance = 0.0
    features = []
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
            edge_wgs84 = LineString([(float(point[0]), float(point[1])) for point in coordinates])
        except (TypeError, ValueError):
            continue
        edge_projected = transform(TO_PROJECTED.transform, edge_wgs84)
        route_distance += edge_projected.length
        way_id = raw_edge.get("wayId")
        if not isinstance(way_id, (int, float)):
            continue
        sections = sections_by_way.get(int(way_id), {})
        overlaps = []
        for section_id, section in sections.items():
            projected_section = transform(TO_PROJECTED.transform, section["geometry"])
            overlap = edge_projected.intersection(projected_section.buffer(2.5, cap_style="flat"))
            if overlap.is_empty or overlap.length <= 0.01:
                continue
            overlaps.append(overlap)
            route_overlap = transform(TO_WGS84.transform, overlap)
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "wayId": int(way_id),
                        "sectionId": section_id,
                        "evidenced": True,
                        "sources": section["sources"],
                        "sourceLabels": [SOURCE_BY_ID[source]["label"] for source in section["sources"]],
                        "featureReferences": section["references"],
                    },
                    "geometry": mapping(route_overlap),
                }
            )
        if overlaps:
            # This union is deliberately per supplied edge so repeated traversal counts again.
            evidenced_distance += unary_union(overlaps).length
    fraction = min(1.0, evidenced_distance / route_distance) if route_distance else 0.0
    return {
        "routeDistanceM": round(route_distance, 3),
        "evidencedDistanceM": round(evidenced_distance, 3),
        "evidencedFraction": round(fraction, 6),
        "segments": {"type": "FeatureCollection", "features": features},
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "OpenLooperEvidence/0.1"

    def send_json(self, status: int, data: dict) -> None:
        encoded = json.dumps(data, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/status":
            self.send_json(
                200,
                {
                    "ready": True,
                    "metadata": METADATA,
                    "pbfChecksum": METADATA["osm_pbf_sha256"],
                    "sources": SOURCES,
                },
            )
            return
        if parsed.path == "/evidence/sections":
            try:
                query = parse_qs(parsed.query)
                values = [float(value) for value in query.get("bbox", [""])[0].split(",")]
                if len(values) != 4 or values[0] >= values[2] or values[1] >= values[3]:
                    raise ValueError("bbox must be west,south,east,north")
                source = query.get("source", [None])[0]
                if source and source not in SOURCE_BY_ID:
                    raise ValueError(f"Unknown evidence source: {source}")
                self.send_json(
                    200,
                    {
                        "type": "FeatureCollection",
                        "features": viewport_features(tuple(values), source),
                    },
                )
            except (ValueError, sqlite3.Error) as error:
                self.send_json(400, {"error": str(error)})
            return
        self.send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/route-evidence":
            self.send_json(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 10 * 1024 * 1024:
                raise ValueError("Request body is missing or too large")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError("Request body must be an object")
            self.send_json(200, route_evidence(payload))
        except (ValueError, json.JSONDecodeError, sqlite3.Error) as error:
            self.send_json(400, {"error": str(error)})

    def log_message(self, message: str, *args) -> None:
        print(f"{self.address_string()} - {message % args}", flush=True)


if __name__ == "__main__":
    print(
        f"Evidence database ready for PBF {METADATA['osm_pbf_sha256']}; listening on {PORT}",
        flush=True,
    )
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
