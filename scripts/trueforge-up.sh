#!/usr/bin/env bash
# Keeps a TrueForge standalone server running in the foreground.
#
# Run this inside WSL. It is a separate script rather than a background job
# because WSL shuts a distro down when its last process exits -- backgrounding
# the server from a one-shot `wsl -- ...` invocation kills it the moment the
# invocation returns.
set -uo pipefail

if [ -f "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || true
fi

echo "node $(node --version)"
exec npx --yes @truefoundry/trueforge@latest
