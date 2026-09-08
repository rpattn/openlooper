#!/usr/bin/env python3
"""One pass over the official GPS archive, keeping only the members that could
hold a coordinate inside one region.

A tiled evidence build runs `prepare_evidence.py` once per tile, and each run
streams the whole archive. That archive is 21 GB of xz, and decompressing it is
single-core: it sets a floor of roughly forty minutes per pass no matter how
small the tile is. Ten tiles would spend most of a day doing nothing but
inflating the same bytes.

So inflate them once. This writes the members that survive the region prefilter
to an uncompressed tar, which later passes read at disk speed. The result is
larger on disk and far cheaper to read, which is the right trade when the node
has spare disk and one core doing xz.

Nothing is decoded here. Members are copied through as bytes, and the same
whole-degree byte prefilter `prepare_evidence.py` applies is the only test, so
this can pass a member with no in-region point but never reject one that has
one. Per-tile filtering still happens in the tile builds themselves.
"""

from __future__ import annotations

import argparse
import io
import json
import tarfile
import time
from collections import defaultdict
from pathlib import Path

from prepare_evidence import (
    HashingReader,
    format_duration,
    member_passes,
    prefilter_prefixes,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gps-archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True, help="Uncompressed .tar to write.")
    parser.add_argument("--provenance", type=Path, required=True)
    parser.add_argument(
        "--bbox",
        required=True,
        help="west,south,east,north covering every tile the intermediate will serve.",
    )
    args = parser.parse_args()

    values = [float(value) for value in args.bbox.split(",")]
    if len(values) != 4 or values[0] >= values[2] or values[1] >= values[3]:
        raise SystemExit("--bbox must be west,south,east,north")
    west, south, east, north = values
    lat_prefixes, lon_prefixes = prefilter_prefixes((west, south, east, north))

    total_bytes = args.gps_archive.stat().st_size
    stats: dict[str, int] = defaultdict(int)
    started = time.monotonic()
    reported = started
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".partial")

    print(
        f"Prefiltering {total_bytes / 1e9:.1f} GB against {args.bbox};"
        " progress prints every 30 seconds.",
        flush=True,
    )
    with args.gps_archive.open("rb") as raw:
        hashing = HashingReader(raw)
        # "r|*" rather than "r|xz" so this also accepts an already-uncompressed
        # intermediate, which makes narrowing a region a cheap second pass.
        with tarfile.open(fileobj=hashing, mode="r|*") as source, \
                tarfile.open(temporary, mode="w") as destination:
            for member in source:
                if not member.isfile() or not member.name.lower().endswith(".gpx"):
                    continue
                visibility = member.name.split("/")[1] if "/" in member.name else "unknown"
                stats["gps_members_total"] += 1
                stats[f"members_{visibility}"] += 1
                extracted = source.extractfile(member)
                if extracted is None:
                    continue
                data = extracted.read()
                if not member_passes(data, lat_prefixes, lon_prefixes):
                    stats["members_prefiltered_out"] += 1
                    continue
                stats["members_kept"] += 1
                stats["bytes_kept"] += len(data)
                # Rebuild the header rather than reusing it: the source member
                # carries offsets into the original archive that mean nothing
                # here, and only the name and size matter downstream.
                copied = tarfile.TarInfo(name=member.name)
                copied.size = len(data)
                copied.mtime = member.mtime
                destination.addfile(copied, io.BytesIO(data))

                now = time.monotonic()
                if now - reported >= 30:
                    reported = now
                    share = hashing.bytes_read / total_bytes
                    elapsed = now - started
                    remaining = elapsed / share - elapsed if share > 0 else 0
                    print(
                        f"  [{format_duration(elapsed)}] {share * 100:5.1f}%"
                        f" · {hashing.bytes_read / 1e9:5.1f}/{total_bytes / 1e9:.1f} GB"
                        f" · kept {stats['members_kept']:,}/{stats['gps_members_total']:,}"
                        f" · about {format_duration(remaining)} left",
                        flush=True,
                    )

        # Drain whatever the tar reader left, so the recorded digests cover the
        # whole file and can be compared against planet.openstreetmap.org.
        while hashing.read(1024 * 1024):
            pass
        source_sha256 = hashing.sha256.hexdigest()
        source_md5 = hashing.md5.hexdigest()

    temporary.replace(args.output)
    provenance = {
        "sourceArchive": args.gps_archive.name,
        "sourceSha256": source_sha256,
        "sourceMd5": source_md5,
        "bbox": args.bbox,
        "elapsedSeconds": round(time.monotonic() - started, 2),
        "intermediateBytes": args.output.stat().st_size,
        **stats,
    }
    args.provenance.write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(provenance, indent=2), flush=True)


if __name__ == "__main__":
    main()
