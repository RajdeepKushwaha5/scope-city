#!/usr/bin/env bash
# Boots TrueForge, probes it, and shuts it down again -- all in one shell, so
# the process outlives the probe. Run this from inside WSL; on Windows the
# standalone server segfaults and the sandbox provider is unavailable.
set -uo pipefail

BASE="http://localhost:8790"
LOG=/tmp/tf-verify.log

echo "== booting trueforge =="
npx --yes @truefoundry/trueforge@latest > "${LOG}" 2>&1 &
TF_PID=$!

# shellcheck disable=SC2064
trap "kill ${TF_PID} 2>/dev/null" EXIT

for _ in $(seq 1 60); do
  if curl -s -m 2 -o /dev/null "${BASE}/"; then break; fi
  sleep 1
done

code=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "${BASE}/")
echo "  root -> HTTP ${code}"
if [ "${code}" != "200" ]; then
  echo "  never came up; last log lines:"
  tail -20 "${LOG}"
  exit 1
fi

echo
echo "== sandbox availability =="
if grep -q "Local sandbox fallback is unavailable" "${LOG}"; then
  echo "  UNAVAILABLE:"
  grep -o 'reason":"[^"]*"' "${LOG}" | head -1 | sed 's/^/    /'
else
  echo "  available"
fi

echo
echo "== openapi =="
SPEC=""
for path in /api/v1/openapi.json /api/v1/docs/json /openapi.json /api/v1/docs/openapi.json; do
  code=$(curl -s -m 5 -o /tmp/tf-spec.json -w "%{http_code}" "${BASE}${path}")
  size=$(stat -c%s /tmp/tf-spec.json 2>/dev/null || echo 0)
  echo "  ${path} -> ${code} (${size}b)"
  if [ "${code}" = "200" ] && [ "${size}" -gt 1000 ]; then SPEC="${path}"; break; fi
done

if [ -n "${SPEC}" ]; then
  echo
  echo "== routes =="
  node -e '
const spec = JSON.parse(require("fs").readFileSync("/tmp/tf-spec.json", "utf8"));
for (const [p, ops] of Object.entries(spec.paths || {})) {
  const verbs = Object.keys(ops)
    .filter((v) => ["get", "post", "put", "patch", "delete"].includes(v))
    .map((v) => v.toUpperCase())
    .join(",");
  console.log("  " + verbs.padEnd(12) + p);
}
'
else
  echo
  echo "== probing known routes =="
  for path in /api/v1/sessions /api/v1/agents /api/v1/mcp-servers /api/v1/models; do
    code=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "${BASE}${path}")
    echo "  GET ${path} -> ${code}"
  done
fi

echo
echo "== done =="
