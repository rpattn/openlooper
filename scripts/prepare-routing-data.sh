#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$(cd "${SCRIPT_DIR}/../docker/valhalla/data" && pwd)"
SOURCE_DIR="${DATA_DIR}/sources"
STAFFORDSHIRE_URL="https://download.geofabrik.de/europe/united-kingdom/england/staffordshire-latest.osm.pbf"
DERBYSHIRE_URL="https://download.geofabrik.de/europe/united-kingdom/england/derbyshire-latest.osm.pbf"
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
download "${STAFFORDSHIRE_URL}" "${SOURCE_DIR}/staffordshire.osm.pbf" "/data/sources/staffordshire.osm.pbf"
download "${DERBYSHIRE_URL}" "${SOURCE_DIR}/derbyshire.osm.pbf" "/data/sources/derbyshire.osm.pbf"

echo "Merging extracts with ${OSMIUM_IMAGE}…"
docker run --rm -v "${DATA_DIR}:/data" "${OSMIUM_IMAGE}" merge --overwrite /data/sources/staffordshire.osm.pbf /data/sources/derbyshire.osm.pbf -o /data/local-region.osm.pbf
stat --format='Merged: %n | Size: %s bytes | Modified: %y' "${DATA_DIR}/local-region.osm.pbf"
echo "Routing data is ready. Run: npm run routing:up"
