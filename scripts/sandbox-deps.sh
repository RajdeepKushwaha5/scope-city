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

have() { command -v "$1" >/dev/null 2>&1; }

echo "== checking =="
for tool in bwrap socat rg; do
  if have "$tool"; then
    echo "  $tool: $(command -v "$tool")"
  else
    echo "  $tool: MISSING"
  fi
done

# --- ripgrep: an official static musl build ------------------------------
if ! have rg; then
  echo
  echo "== installing ripgrep =="
  RG_VER="14.1.1"
  RG_TGZ="ripgrep-${RG_VER}-x86_64-unknown-linux-musl.tar.gz"
  if curl -fsSL -o "/tmp/${RG_TGZ}" \
      "https://github.com/BurntSushi/ripgrep/releases/download/${RG_VER}/${RG_TGZ}"; then
    tar -xzf "/tmp/${RG_TGZ}" -C /tmp
    install -m 0755 "/tmp/ripgrep-${RG_VER}-x86_64-unknown-linux-musl/rg" "${BIN}/rg"
    echo "  installed ${BIN}/rg"
  else
    echo "  download failed — falling back to: sudo apt-get install -y ripgrep"
  fi
fi

# --- socat: no official static release, so try apt and explain if it fails
if ! have socat; then
  echo
  echo "== socat =="
  # -n so this never blocks waiting for a password.
  if sudo -n apt-get install -y socat >/dev/null 2>&1; then
    echo "  installed via apt"
  else
    echo "  socat has no official static build and apt needs a password."
    echo "  Run this once, interactively:"
    echo
    echo "      sudo apt-get install -y socat"
    echo
  fi
fi

echo
echo "== result =="
export PATH="${BIN}:${PATH}"
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
  echo "  All present. Restart TrueForge and the local sandbox provider appears."
  echo "  Add to your shell profile so it survives a new terminal:"
  echo "      export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

exit "${missing}"
