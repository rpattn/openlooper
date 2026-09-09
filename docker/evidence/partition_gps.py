#!/usr/bin/env python3
"""Splits the prefiltered GPS intermediate into one archive per tile.

Every tile build streams the whole intermediate to find the members that touch
it. That scan dominates a tiled build: measured here, 23 GB takes about fourteen
minutes, so thirty tiles spend seven hours reading the same bytes to discard
almost all of them. Doing the split once turns that into one pass plus a small
read per tile.

The obvious implementation is slower than what it replaces. `member_passes()`
searches a member's bytes for the whole-degree substrings one region can contain;
running it per tile means thirty scans of every member. Instead each member is
scanned once for the integer parts of its own coordinates, and a tile takes the
member when those overlap the bands its bounding box can hold. Same
whole-degree, necessary-condition test as the single prefilter — it can pass a
member with no in-tile point, never reject one that has one — computed once
rather than per tile.

Members are copied as bytes; nothing is decoded, and per-tile filtering still
happens properly inside prepare_evidence.py.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import tarfile
import time
from pathlib import Path

from prepare_evidence import HashingReader, format_duration, integer_parts

# The archive is written by OSM's own gpx_dump.py, so coordinates are always
# double- or single-quoted attributes. Capture the integer part exactly as
# written, because that is what integer_parts() enumerates: truncation toward
# zero, so -0.6 is written "-0" and belongs to the "-0" band.
LAT_INT = re.compile(rb'\blat\s*=\s*["\']([-+]?\d+)')
LON_INT = re.compile(rb'\blon\s*=\s*["\']([-+]?\d+)')


def normalise(parts: set[bytes]) -> set[str]:
    return {part.decode().lstrip("+") for part in parts}


def bands(low: float, high: float) -> set[str]:
    return {part.lstrip("+") for part in integer_parts(low, high)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gps-archive", type=Path, required=True,
                        help="The prefiltered intermediate, or the original archive.")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()

    tiles: list[tuple[str, set[str], set[str], tarfile.TarFile, Path, int]] = []
    entries = []
    for line in args.manifest.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        index, _own, extract = line.split("\t")
        west, south, east, north = (float(v) for v in extract.split(","))
        entries.append((index, bands(south, north), bands(west, east)))
    if not entries:
        raise SystemExit(f"No tiles in {args.manifest}.")

    args.out_dir.mkdir(parents=True, exist_ok=True)
    done = all((args.out_dir / f"gps-{index}.tar").exists() for index, _, _ in entries)
    if done:
        print(f"All {len(entries)} per-tile archives already present; keeping them.")
        return

    total_bytes = args.gps_archive.stat().st_size
    started = time.monotonic()
    reported = started
    members = 0
    written = 0
    handles = []
    for index, lat_bands, lon_bands in entries:
        path = args.out_dir / f"gps-{index}.tar.partial"
        handles.append((index, lat_bands, lon_bands, tarfile.open(path, mode="w"), path, [0]))

    print(
        f"Partitioning {total_bytes / 1e9:.1f} GB across {len(handles)} tiles;"
        " progress prints every 30 seconds.",
        flush=True,
    )
    with args.gps_archive.open("rb") as raw:
        hashing = HashingReader(raw)
        with tarfile.open(fileobj=hashing, mode="r|*") as source:
            for member in source:
                if not member.isfile() or not member.name.lower().endswith(".gpx"):
                    continue
                extracted = source.extractfile(member)
                if extracted is None:
                    continue
                data = extracted.read()
                members += 1
                # One scan of the member, reused by every tile below.
                member_lat = normalise(set(LAT_INT.findall(data)))
                member_lon = normalise(set(LON_INT.findall(data)))
                for _index, lat_bands, lon_bands, handle, _path, counter in handles:
                    if member_lat & lat_bands and member_lon & lon_bands:
                        info = tarfile.TarInfo(name=member.name)
                        info.size = len(data)
                        info.mtime = member.mtime
                        handle.addfile(info, io.BytesIO(data))
                        counter[0] += 1
                        written += 1

                now = time.monotonic()
                if now - reported >= 30:
                    reported = now
                    share = hashing.bytes_read / total_bytes
                    elapsed = now - started
                    remaining = elapsed / share - elapsed if share > 0 else 0
                    print(
                        f"  [{format_duration(elapsed)}] {share * 100:5.1f}%"
                        f" · {hashing.bytes_read / 1e9:5.1f}/{total_bytes / 1e9:.1f} GB"
                        f" · {members:,} members · {written:,} placements"
                        f" · about {format_duration(remaining)} left",
                        flush=True,
                    )

    summary = {}
    for index, _lat, _lon, handle, path, counter in handles:
        handle.close()
        final = path.with_suffix("")
        path.replace(final)
        summary[index] = {"members": counter[0], "bytes": final.stat().st_size}
    (args.out_dir / "partition-report.json").write_text(
        json.dumps(
            {
                "sourceMembers": members,
                "placements": written,
                # Above 1.0 because a member near a degree boundary belongs to
                # every tile whose bands it touches. That duplication is the
                # cost of never scanning the whole intermediate again.
                "duplicationFactor": round(written / members, 3) if members else 0,
                "elapsedSeconds": round(time.monotonic() - started, 2),
                "tiles": summary,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(
        f"{members:,} members became {written:,} placements"
        f" ({written / members if members else 0:.2f}x) in {format_duration(time.monotonic() - started)}",
        flush=True,
    )
    for index, detail in summary.items():
        print(f"  tile {index}: {detail['members']:,} members, {detail['bytes'] / 1e6:.1f} MB", flush=True)


if __name__ == "__main__":
    main()
