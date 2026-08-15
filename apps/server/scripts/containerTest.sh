#!/bin/sh
# Builds the image and runs a real sort inside it against host volumes.
#
# This is the only check that can catch permission and ownership mistakes: a
# container writing as root leaves behind a library the user cannot manage, and
# no unit test can see that.
set -e

IMAGE="stl-manager:containertest"
NAME="stl-manager-containertest"
PORT="${PORT:-8123}"
WORK="$(mktemp -d /tmp/stl-container-XXXXXX)"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$WORK/downloads" "$WORK/library" "$WORK/config"
for name in kit_base kit_lip kit_straight orc_bust_a orc_bust_b; do
  printf 'mesh-%s' "$name" > "$WORK/downloads/$name.stl"
done
cp "$WORK/downloads/kit_base.stl" "$WORK/downloads/kit_base (1).stl"

echo "Building the image."
docker build -q -f "$ROOT/apps/server/Dockerfile" -t "$IMAGE" "$ROOT" > /dev/null

echo "Starting the container."
docker run -d --name "$NAME" -p "$PORT:8080" \
  -e PUID="$(id -u)" -e PGID="$(id -g)" -e STL_ROOTS=/data \
  -v "$WORK/downloads:/data/downloads" \
  -v "$WORK/library:/data/library" \
  -v "$WORK/config:/config" \
  "$IMAGE" > /dev/null

for _ in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/health" > /dev/null 2>&1; then break; fi
  sleep 1
done

TOKEN="$(cat "$WORK/config/token")"
AUTH="Authorization: Bearer $TOKEN"

echo "Scanning."
JOB="$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"roots":["/data/downloads"],"libraryRoot":"/data/library"}' \
  "http://localhost:$PORT/api/scans" | node -pe "JSON.parse(require('fs').readFileSync(0)).value.jobId")"
sleep 2

MOVES="$(curl -s -H "$AUTH" "http://localhost:$PORT/api/jobs/$JOB" \
  | node -pe "JSON.stringify(JSON.parse(require('fs').readFileSync(0)).value.result.moves)")"

echo "Applying."
AJOB="$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"libraryRoot\":\"/data/library\",\"moves\":$MOVES}" \
  "http://localhost:$PORT/api/applies" | node -pe "JSON.parse(require('fs').readFileSync(0)).value.jobId")"
sleep 2

STATE="$(curl -s -H "$AUTH" "http://localhost:$PORT/api/jobs/$AJOB" \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).value.state")"
if [ "$STATE" != "succeeded" ]; then
  echo "FAILED: the apply job ended as $STATE"
  exit 1
fi

FOUND="$(find "$WORK/library" -type f -not -path '*stl-manager*' | sed "s|$WORK/library/||" | sort | tr '\n' ' ')"
EXPECTED="_Duplicates/kit_base.stl kit/kit_base.stl kit/kit_lip.stl kit/kit_straight.stl orc_bust/orc_bust_a.stl orc_bust/orc_bust_b.stl "
if [ "$FOUND" != "$EXPECTED" ]; then
  echo "FAILED: the library was"
  echo "  $FOUND"
  echo "expected"
  echo "  $EXPECTED"
  exit 1
fi

# stat differs between macOS and Linux, so try both spellings.
OWNER="$(find "$WORK/library" -type f -not -path '*stl-manager*' -exec stat -f '%Su' {} \; 2>/dev/null | sort -u)"
if [ -z "$OWNER" ]; then
  OWNER="$(find "$WORK/library" -type f -not -path '*stl-manager*' -exec stat -c '%U' {} \; | sort -u)"
fi
if [ "$OWNER" != "$(id -un)" ]; then
  echo "FAILED: sorted files are owned by $OWNER, not $(id -un)"
  exit 1
fi

echo "Container test passed: sorted correctly and the files belong to $(id -un)."
