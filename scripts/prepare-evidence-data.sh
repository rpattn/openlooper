#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
EVIDENCE_DIR="${PROJECT_DIR}/docker/evidence"
DATA_DIR="${EVIDENCE_DIR}/data"
SOURCE_DIR="${DATA_DIR}/sources"
PBF="${PROJECT_DIR}/docker/valhalla/data/local-region.osm.pbf"
ARCHIVE="${SOURCE_DIR}/gpx-planet-2013-04-09.tar.xz"
MD5_FILE="${ARCHIVE}.md5"
ARCHIVE_URL="https://planet.openstreetmap.org/gps/gpx-planet-2013-04-09.tar.xz"
MD5_URL="${ARCHIVE_URL}.md5"
IMAGE="openlooper-evidence:local"

if [[ ! -s "${PBF}" ]]; then
  echo "Missing current regional PBF: ${PBF}" >&2
  echo "Run npm run routing:prepare first." >&2
  exit 1
fi

mkdir -p "${SOURCE_DIR}"
if [[ ! -s "${ARCHIVE}" ]]; then
  echo "Downloading the approximately 21 GB official 2013 OSM GPS archive (resumable)…"
  curl --fail --location --retry 3 --connect-timeout 20 --continue-at - --output "${ARCHIVE}" "${ARCHIVE_URL}"
else
  echo "Using existing compressed GPS archive: ${ARCHIVE}"
fi
curl --fail --location --retry 3 --connect-timeout 20 --output "${MD5_FILE}" "${MD5_URL}"

expected_md5="$(awk '{print $1; exit}' "${MD5_FILE}")"
actual_md5="$(md5sum "${ARCHIVE}" | awk '{print $1}')"
if [[ -z "${expected_md5}" || "${actual_md5}" != "${expected_md5}" ]]; then
  echo "GPS archive MD5 mismatch: expected ${expected_md5:-unknown}, got ${actual_md5}" >&2
  exit 1
fi

echo "Building pinned Python 3.12 evidence preparation image…"
docker build --tag "${IMAGE}" "${EVIDENCE_DIR}"
docker run --rm \
  -v "${PROJECT_DIR}/docker/valhalla/data:/routing:ro" \
  -v "${DATA_DIR}:/evidence" \
  "${IMAGE}" \
  python /app/prepare_evidence.py \
    --pbf /routing/local-region.osm.pbf \
    --gps-archive /evidence/sources/gpx-planet-2013-04-09.tar.xz \
    --output /evidence/route-use-evidence.sqlite \
    --report /evidence/build-report.json

echo "Evidence data is ready. Run: npm run evidence:up"
