#!/bin/sh
# Cuts the evidence region into a grid of overlapping tiles. Runs in the osmium
# image; the build loop that consumes the manifest runs in the evidence image.
#
#   tile_region.sh <region.pbf> <out-dir> <west,south,east,north> <cols> <rows> <margin-degrees>
#
# Each tile is extracted with a margin of context beyond the cell it owns, and
# prepare_evidence.py is later told to write only the ways whose midpoint falls
# inside the cell. Both halves are needed:
#
#   Ownership without context attributes coordinates to the wrong way at cell
#   edges, because the truly nearest way was cut away. Context without ownership
#   keeps those wrong attributions in the union.
#
# The margin has to cover the largest neighbourhood any rule consults, and that
# is not the 24 m matching radius — it is greenspace and water polygons, which
# run to kilometres. Measured against a whole-region build, 0.002 degrees still
# lost evidence up to 830 m from a boundary; 0.05 degrees reproduced it exactly.
set -eu

PBF="$1"; OUT="$2"; BBOX="$3"; COLS="$4"; ROWS="$5"; MARGIN="$6"

mkdir -p "$OUT"

# Tiles are named by index and both this script and build_tiles.sh keep finished
# work so a failed run resumes. That is only safe while the grid is unchanged:
# after re-tiling, tile-0 means a different piece of the world. Changing any
# parameter therefore discards everything derived from the old one.
GRID_ID="$BBOX|$COLS|$ROWS|$MARGIN"
if [ -f "$OUT/grid.id" ] && [ "$(cat "$OUT/grid.id")" != "$GRID_ID" ]; then
  echo "Grid changed:"
  echo "  was $(cat "$OUT/grid.id")"
  echo "  now $GRID_ID"
  echo "Discarding tiles built for the previous grid."
  rm -f "$OUT"/tile-*.osm.pbf "$OUT"/tile-*.sqlite "$OUT"/tile-*.json "$OUT"/manifest.tsv
fi
printf '%s' "$GRID_ID" > "$OUT/grid.id"

echo "$BBOX" | tr ',' ' ' | while read -r W S E N; do
  awk -v w="$W" -v s="$S" -v e="$E" -v n="$N" -v cols="$COLS" -v rows="$ROWS" -v m="$MARGIN" '
    BEGIN {
      dx = (e - w) / cols; dy = (n - s) / rows; i = 0
      for (c = 0; c < cols; c++) for (r = 0; r < rows; r++) {
        ow = w + c * dx; oe = ow + dx; os = s + r * dy; on = os + dy
        # Outer cells claim everything beyond the region so that no way sitting
        # on the rim is owned by nobody. Interior edges stay exact, and the
        # half-open test in prepare_evidence.py keeps them a partition.
        if (c == 0) ow = -180; if (c == cols - 1) oe = 180
        if (r == 0) os = -90;  if (r == rows - 1) on = 90
        printf "%d\t%.6f,%.6f,%.6f,%.6f\t%.6f,%.6f,%.6f,%.6f\n", i++, ow, os, oe, on, \
          w + c * dx - m, s + r * dy - m, w + (c + 1) * dx + m, s + (r + 1) * dy + m
      }
    }' > "$OUT/manifest.tsv"
done

total=$(wc -l < "$OUT/manifest.tsv")
echo "Cutting $total tiles from $PBF with a ${MARGIN} degree context margin."
while IFS="$(printf '\t')" read -r index own extract; do
  target="$OUT/tile-$index.osm.pbf"
  if [ -s "$target" ]; then
    echo "  tile $index: already extracted, keeping it"
  else
    # smart keeps ways whole and completes the multipolygon relations that
    # greenspace and water are built from.
    partial="$OUT/tile-$index.partial.osm.pbf"
    osmium extract --overwrite --strategy smart --bbox "$extract" "$PBF" -o "$partial"
    mv "$partial" "$target"
  fi
  size=$(wc -c < "$target")
  awk -v i="$index" -v b="$size" -v own="$own" \
    'BEGIN { printf "  tile %s: %8.1f MB  owns %s  projected peak %.1f GiB\n", i, b/1048576, own, b*50/1073741824 }'
done < "$OUT/manifest.tsv"

echo
echo "Largest tile decides peak memory. Raise cols/rows if any projected peak"
echo "is near the Job's limit; the whole region is the sum of the cells either way."
