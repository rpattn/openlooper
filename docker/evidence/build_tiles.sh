#!/bin/sh
# Builds one evidence database per tile, then merges them.
#
#   build_tiles.sh <tile-dir> <region.pbf> <gps-archive> <provenance> <output.sqlite> <report.json> <workers>
#
# Each tile build is a normal prepare_evidence.py run over a small PBF, so peak
# memory is set by the largest tile rather than by the whole region. Completed
# tiles are kept, so re-running after a failure resumes rather than restarting.
set -eu

TILES="$1"; PBF="$2"; ARCHIVE="$3"; PROVENANCE="$4"; OUTPUT="$5"; REPORT="$6"; WORKERS="$7"

# "auto" defers to prepare_evidence.py, which sizes the pool from the cores it
# can actually see rather than from a number written months ago on a different
# machine.
if [ "$WORKERS" = "auto" ]; then
  WORKER_FLAG=""
else
  WORKER_FLAG="--workers $WORKERS"
fi

merge_args=""
while IFS="$(printf '\t')" read -r index own extract; do
  db="$TILES/tile-$index.sqlite"
  report="$TILES/tile-$index.json"
  if [ -s "$db" ] && [ -s "$report" ]; then
    echo "=== tile $index: already built, keeping it ==="
  else
    echo "=== tile $index: building, owns $own ==="
    # Prefer this tile's own slice of the archive. Falling back to the shared
    # intermediate keeps the script working if the partition step is skipped,
    # only far more slowly: the shared file is scanned in full by every tile.
    slice="$TILES/gps-$index.tar"
    [ -s "$slice" ] || slice="$ARCHIVE"
    python /app/prepare_evidence.py \
      --pbf "$TILES/tile-$index.osm.pbf" \
      --gps-archive "$slice" \
      --gps-provenance "$PROVENANCE" \
      --own-bbox="$own" \
      --output "$db" \
      --report "$report" \
      --allow-empty \
      $WORKER_FLAG
  fi
  # A cell that is all sea writes no database. That is a normal result of
  # laying a grid over a coastline, not a failure, so it is left out of the
  # merge rather than failing it.
  if [ -s "$db" ]; then
    merge_args="$merge_args --tile $db --tile-report $report"
  else
    echo "    (no highways in this cell; nothing to merge)"
  fi
done < "$TILES/manifest.tsv"

echo "=== merging ==="
# --pbf is the whole evidence region: that is the checksum the service hashes at
# startup, and cutting every tile out of this exact file is what makes the
# merged database's claim to describe it true.
# shellcheck disable=SC2086
python /app/merge_evidence.py $merge_args --pbf "$PBF" --output "$OUTPUT" --report "$REPORT"
