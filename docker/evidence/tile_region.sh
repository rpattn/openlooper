#!/bin/sh
# Cuts the evidence region into tiles small enough to build one at a time.
#
#   tile_region.sh <region.pbf> <out-dir> <w,s,e,n> <cols> <rows> <margin-deg> <max-tile-bytes>
#
# A uniform grid does not work over a real country. Measured on England, Wales
# and Northern Ireland at 7x6: eight cells held nothing at all, while the cell
# containing London held 327 MB and projected 16 GiB of preparation memory
# against a 12 GiB ceiling. Making the grid finer everywhere to fix that one
# cell multiplies the cells that were already empty, and every extra tile costs
# a full pass over the GPS intermediate.
#
# So the grid is only a starting point. Any cell whose extract exceeds
# max-tile-bytes is split into four and re-cut, repeatedly, until every tile
# fits. Dense cities end up finely divided and open sea stays in one piece.
#
# Each tile is extracted with a margin of context beyond the cell it owns, and
# prepare_evidence.py writes only the ways whose midpoint falls inside the cell.
# Both halves are needed: ownership without context attributes coordinates to
# the wrong way at cell edges, and context without ownership keeps those wrong
# attributions in the union. The margin is sized by greenspace and water
# polygons, which run to kilometres, not by the 24 m matching radius.
set -eu

PBF="$1"; OUT="$2"; BBOX="$3"; COLS="$4"; ROWS="$5"; MARGIN="$6"; MAX_BYTES="$7"
# Each split quarters a cell's area; four levels is a 256-fold reduction, which
# is far past anything a real region needs and stops a pathological input from
# looping forever.
MAX_DEPTH=4

mkdir -p "$OUT"
GRID_ID="$BBOX|$COLS|$ROWS|$MARGIN|$MAX_BYTES"
if [ -f "$OUT/grid.id" ] && [ "$(cat "$OUT/grid.id")" != "$GRID_ID" ]; then
  echo "Grid changed:"
  echo "  was $(cat "$OUT/grid.id")"
  echo "  now $GRID_ID"
  echo "Discarding tiles built for the previous grid."
  rm -f "$OUT"/tile-*.osm.pbf "$OUT"/tile-*.bbox "$OUT"/tile-*.sqlite \
        "$OUT"/tile-*.json "$OUT"/gps-*.tar "$OUT"/manifest.tsv
fi
printf '%s' "$GRID_ID" > "$OUT/grid.id"

# Work queue of nominal cells: west south east north depth
echo "$BBOX" | tr ',' ' ' | while read -r W S E N; do
  awk -v w="$W" -v s="$S" -v e="$E" -v n="$N" -v cols="$COLS" -v rows="$ROWS" '
    BEGIN {
      dx = (e - w) / cols; dy = (n - s) / rows
      for (c = 0; c < cols; c++) for (r = 0; r < rows; r++)
        printf "%.6f %.6f %.6f %.6f 0\n", w + c*dx, s + r*dy, w + (c+1)*dx, s + (r+1)*dy
    }' > "$OUT/queue"
done

REGION_W=$(echo "$BBOX" | cut -d, -f1); REGION_S=$(echo "$BBOX" | cut -d, -f2)
REGION_E=$(echo "$BBOX" | cut -d, -f3); REGION_N=$(echo "$BBOX" | cut -d, -f4)

: > "$OUT/manifest.tsv"
index=0
splits=0
echo "Cutting tiles from $PBF, splitting any above $MAX_BYTES bytes."
while [ -s "$OUT/queue" ]; do
  read -r cw cs ce cn depth < "$OUT/queue"
  sed -i '1d' "$OUT/queue"

  target="$OUT/tile-$index.osm.pbf"
  sidecar="$OUT/tile-$index.bbox"
  extract=$(awk -v w="$cw" -v s="$cs" -v e="$ce" -v n="$cn" -v m="$MARGIN" \
    'BEGIN { printf "%.6f,%.6f,%.6f,%.6f", w-m, s-m, e+m, n+m }')
  # Reuse is keyed to the cell, never to the index. Index only advances when a
  # tile is emitted, so while a cell is being split this filename is written and
  # discarded for several different candidates and finally holds whichever one
  # fit. Trusting it by name on a later run hands a big cell the small extract
  # left behind by another, which then looks as though it fits and is emitted
  # with the wrong geometry entirely.
  if [ -s "$target" ] && [ -f "$sidecar" ] && [ "$(cat "$sidecar")" = "$extract" ]; then
    :
  else
    # Anything derived from the old contents of this index is now stale.
    rm -f "$target" "$sidecar" "$OUT/tile-$index.sqlite" "$OUT/tile-$index.json" "$OUT/gps-$index.tar"
    # smart keeps ways whole and completes the multipolygon relations that
    # greenspace and water are built from.
    osmium extract --overwrite --strategy smart --bbox "$extract" "$PBF" -o "$target.partial.osm.pbf"
    mv "$target.partial.osm.pbf" "$target"
    printf '%s' "$extract" > "$sidecar"
  fi
  size=$(wc -c < "$target")

  if [ "$size" -gt "$MAX_BYTES" ] && [ "$depth" -lt "$MAX_DEPTH" ]; then
    rm -f "$target" "$sidecar"
    splits=$((splits + 1))
    awk -v w="$cw" -v s="$cs" -v e="$ce" -v n="$cn" -v d="$depth" 'BEGIN {
      mx = (w + e) / 2; my = (s + n) / 2; d1 = d + 1
      printf "%.6f %.6f %.6f %.6f %d\n", w, s, mx, my, d1
      printf "%.6f %.6f %.6f %.6f %d\n", mx, s, e, my, d1
      printf "%.6f %.6f %.6f %.6f %d\n", w, my, mx, n, d1
      printf "%.6f %.6f %.6f %.6f %d\n", mx, my, e, n, d1
    }' >> "$OUT/queue"
    awk -v s="$size" -v m="$MAX_BYTES" 'BEGIN { printf "  %.1f MB is over the %.0f MB limit; splitting into four\n", s/1048576, m/1048576 }'
    continue
  fi

  # Cells on the rim claim everything beyond the region, so no way sitting just
  # outside it is owned by nobody. Interior edges stay exact, and the half-open
  # test in prepare_evidence.py keeps them a partition.
  own=$(awk -v w="$cw" -v s="$cs" -v e="$ce" -v n="$cn" \
             -v rw="$REGION_W" -v rs="$REGION_S" -v re="$REGION_E" -v rn="$REGION_N" 'BEGIN {
    if (w <= rw + 1e-9) w = -180; if (e >= re - 1e-9) e = 180
    if (s <= rs + 1e-9) s = -90;  if (n >= rn - 1e-9) n = 90
    printf "%.6f,%.6f,%.6f,%.6f", w, s, e, n
  }')
  printf '%d\t%s\t%s\n' "$index" "$own" "$extract" >> "$OUT/manifest.tsv"
  awk -v i="$index" -v b="$size" -v own="$own" -v d="$depth" \
    'BEGIN { printf "  tile %-3s depth %s %8.1f MB  projected peak %5.1f GiB  owns %s\n", i, d, b/1048576, b*50/1073741824, own }'
  index=$((index + 1))
done
rm -f "$OUT/queue"

echo
awk -v n="$index" -v s="$splits" 'BEGIN { printf "%d tiles after %d split(s).\n", n, s }'
echo "Empty tiles cost one PBF read and are skipped by the build."
