#!/usr/bin/env bash
# Boots TrueForge, dumps the request schemas Scope City depends on, shuts down.
# Run inside WSL: bash scripts/dump-trueforge-schemas.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="http://localhost:8790"

npx --yes @truefoundry/trueforge@latest > /tmp/tf-schema.log 2>&1 &
TF_PID=$!
# shellcheck disable=SC2064
trap "kill ${TF_PID} 2>/dev/null" EXIT

for _ in $(seq 1 60); do
  curl -s -m 2 -o /dev/null "${BASE}/" && break
  sleep 1
done

if ! curl -s -m 5 -o /tmp/tf-spec.json "${BASE}/api/v1/openapi.json"; then
  echo "could not fetch openapi"
  tail -20 /tmp/tf-schema.log
  exit 1
fi

node "${HERE}/dump-schemas.mjs" /tmp/tf-spec.json
