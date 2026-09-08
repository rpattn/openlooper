#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$(cd "${SCRIPT_DIR}/../docker/valhalla/data" && pwd)"
SOURCE_DIR="${DATA_DIR}/sources"
GEOFABRIK="https://download.geofabrik.de/europe/united-kingdom/england"

# The region is whatever extracts are merged here. Override with a space- or
# newline-separated list of Geofabrik URLs to widen or move it. Geofabrik splits
# England by county, not by region, so widening means naming more counties:
#
#   base=https://download.geofabrik.de/europe/united-kingdom/england
#   OPENLOOPER_REGION_URLS="\
#     $base/staffordshire-latest.osm.pbf \
#     $base/derbyshire-latest.osm.pbf \
#     $base/cheshire-latest.osm.pbf" npm run routing:prepare
#
# See docs/deployment.md for what a wider region costs to prepare.
#
# Evidence preparation projects to EPSG:27700, the British National Grid, so the
# region has to stay inside Great Britain; it degrades quickly beyond that and
# is meaningless in Northern Ireland or the Republic.
DEFAULT_REGION_URLS="${GEOFABRIK}/staffordshire-latest.osm.pbf
${GEOFABRIK}/derbyshire-latest.osm.pbf"
read -r -a REGION_URLS <<< "$(echo "${OPENLOOPER_REGION_URLS:-${DEFAULT_REGION_URLS}}" | tr '\n' ' ')"
if (( ${#REGION_URLS[@]} == 0 )); then
  echo "OPENLOOPER_REGION_URLS is set but empty." >&2
  exit 1
fi

case "$(uname -m)" in
  arm64|aarch64) OSMIUM_IMAGE="mvherweg/gis-arm64-osmium:1.18.0" ;;
  amd64|x86_64) OSMIUM_IMAGE="iboates/osmium:1.18.0" ;;
  *) echo "Unsupported host architecture for the pinned Osmium images: $(uname -m)" >&2; exit 1 ;;
esac

download() {
  local url="$1"
  local output="$2"
  local container_path="$3"
  if [[ -s "${output}" ]] && [[ $(wc -c < "${output}") -gt 1000000 ]] && docker run --rm -v "${DATA_DIR}:/data" "${OSMIUM_IMAGE}" fileinfo "${container_path}" >/dev/null 2>&1; then
    echo "Using existing valid download: ${output}"
  else
    local resolved_url
    resolved_url="$(curl --fail --silent --show-error --head --connect-timeout 20 "${url}" | awk 'tolower($1) == "location:" { gsub("\r", "", $2); print $2; exit }')"
    curl --fail --location --retry 3 --connect-timeout 20 --continue-at - --remote-time --output "${output}" "${resolved_url:-${url}}"
    docker run --rm -v "${DATA_DIR}:/data" "${OSMIUM_IMAGE}" fileinfo "${container_path}" >/dev/null
  fi
  echo "Source: ${url}"
  stat --format='File: %n | Size: %s bytes | Modified: %y' "${output}"
}

mkdir -p "${SOURCE_DIR}"
merge_inputs=()
for url in "${REGION_URLS[@]}"; do
  name="$(basename "${url}")"
  download "${url}" "${SOURCE_DIR}/${name}" "/data/sources/${name}"
  merge_inputs+=("/data/sources/${name}")
done

echo "Merging ${#merge_inputs[@]} extract(s) with ${OSMIUM_IMAGE}…"
docker run --rm -v "${DATA_DIR}:/data" "${OSMIUM_IMAGE}" merge --overwrite "${merge_inputs[@]}" -o /data/local-region.osm.pbf
stat --format='Merged: %n | Size: %s bytes | Modified: %y' "${DATA_DIR}/local-region.osm.pbf"

# Valhalla and the evidence database are both keyed to this exact file: the
# service compares this checksum against the one recorded at build time and
# refuses to start on a mismatch.
echo "local-region.osm.pbf SHA-256: $(sha256sum "${DATA_DIR}/local-region.osm.pbf" | awk '{print $1}')"
echo "Routing data is ready. Run: npm run routing:up"
