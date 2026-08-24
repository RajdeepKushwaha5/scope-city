#!/usr/bin/env bash
# Installs TrueForge's local sandbox dependencies without root.
#
# The local sandbox provider needs bwrap, socat and ripgrep on PATH. Ubuntu
# ships bubblewrap already; the other two normally come from apt, which needs a
# password we cannot supply from a non-interactive shell. Both publish static
# binaries, so they can go in ~/.local/bin instead.
#
# If apt is available to you interactively, this is the same thing in one line:
#   sudo apt-get install -y socat ripgrep
set -uo pipefail

BIN="$HOME/.local/bin"
mkdir -p "$BIN"
export PATH="${BIN}:${PATH}"

have() { command -v "$1" >/dev/null 2>&1; }

echo "== checking =="
for tool in bwrap socat rg; do
  if have "$tool"; then
    echo "  $tool: $(command -v "$tool")"
  else
    echo "  $tool: MISSING"
  fi
done

# --- ripgrep: select the official artifact for this host -----------------
if ! have rg; then
  echo
  echo "== installing ripgrep =="
  RG_VER="14.1.1"
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  TARGET=""
  case "${OS}/${ARCH}" in
    Linux/x86_64) TARGET="x86_64-unknown-linux-musl" ;;
    Linux/aarch64|Linux/arm64) TARGET="aarch64-unknown-linux-gnu" ;;
    Darwin/x86_64) TARGET="x86_64-apple-darwin" ;;
    Darwin/arm64) TARGET="aarch64-apple-darwin" ;;
  esac

  if [ -z "${TARGET}" ]; then
    echo "  unsupported host ${OS}/${ARCH}; install ripgrep with your package manager"
  else
    RG_TGZ="ripgrep-${RG_VER}-${TARGET}.tar.gz"
    TEMP_ROOT="${TMPDIR:-/tmp}"
    if curl -fsSL -o "${TEMP_ROOT}/${RG_TGZ}" \
      "https://github.com/BurntSushi/ripgrep/releases/download/${RG_VER}/${RG_TGZ}"; then
      tar -xzf "${TEMP_ROOT}/${RG_TGZ}" -C "${TEMP_ROOT}"
      install -m 0755 "${TEMP_ROOT}/ripgrep-${RG_VER}-${TARGET}/rg" "${BIN}/rg"
      echo "  installed ${BIN}/rg"
    else
      echo "  download failed; install ripgrep with apt, brew, or your package manager"
    fi
  fi
fi

# --- socat: no official static release, so try apt and explain if it fails
if ! have socat; then
  echo
  echo "== socat =="
  # -n so this never blocks waiting for a password.
  if command -v apt-get >/dev/null 2>&1 && sudo -n apt-get install -y socat >/dev/null 2>&1; then
    echo "  installed via apt"
  else
    echo "  socat needs a system package. Run one of these interactively:"
    echo
    echo "      sudo apt-get install -y socat  # Debian/Ubuntu"
    echo "      brew install socat             # macOS"
    echo
  fi
fi

echo
echo "== result =="
missing=0
for tool in bwrap socat rg; do
  if have "$tool"; then
    echo "  $tool  ok"
  else
    echo "  $tool  still missing"
    missing=1
  fi
done

if [ "${missing}" -eq 0 ]; then
  echo
  echo "  All present. Launch TrueForge through the repository wrapper so its"
  echo "  process inherits this user-local PATH:"
  echo "      ./scripts/trueforge.sh"
fi

exit "${missing}"
