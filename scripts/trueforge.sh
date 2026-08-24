#!/usr/bin/env bash
# Starts TrueForge with dependencies installed by sandbox-deps.sh visible.
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

for tool in bwrap socat rg; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "missing $tool; run ./scripts/sandbox-deps.sh first" >&2
    exit 1
  fi
done

exec npx @truefoundry/trueforge "$@"
