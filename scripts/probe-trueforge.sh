#!/usr/bin/env bash
# Probes a running TrueForge instance and reports what it actually exposes.
#
# We code against this output rather than against documentation, because the
# two have already disagreed once (the hosted platform SDK is a different
# product from the open-source harness).
set -uo pipefail

BASE="${TRUEFORGE_BASE_URL:-http://localhost:8790}"

echo "== reachability =="
for path in / /api/v1/docs; do
  code=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "${BASE}${path}")
  echo "  ${path} -> HTTP ${code}"
done

echo
echo "== looking for the openapi document =="
SPEC=""
for path in /api/v1/openapi.json /api/v1/docs/json /openapi.json /api/v1/docs/openapi.json /api/openapi.json; do
  code=$(curl -s -m 5 -o /tmp/tf-spec.json -w "%{http_code}" "${BASE}${path}")
  size=$(stat -c%s /tmp/tf-spec.json 2>/dev/null || echo 0)
  echo "  ${path} -> HTTP ${code} (${size} bytes)"
  if [ "${code}" = "200" ] && [ "${size}" -gt 1000 ]; then
    SPEC="${path}"
    break
  fi
done

if [ -z "${SPEC}" ]; then
  echo
  echo "  no openapi document found; falling back to probing known routes"
  echo
  echo "== known routes =="
  for path in /api/v1/sessions /api/v1/agents /api/v1/mcp-servers /api/v1/models /api/v1/skills; do
    code=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "${BASE}${path}")
    echo "  GET ${path} -> HTTP ${code}"
  done
  exit 0
fi

echo
echo "== paths in ${SPEC} =="
node -e '
const fs = require("fs");
const spec = JSON.parse(fs.readFileSync("/tmp/tf-spec.json", "utf8"));
const paths = spec.paths || {};
for (const [p, ops] of Object.entries(paths)) {
  const verbs = Object.keys(ops).filter((v) =>
    ["get", "post", "put", "patch", "delete"].includes(v),
  );
  console.log("  " + verbs.map((v) => v.toUpperCase()).join(",").padEnd(12) + p);
}
'
