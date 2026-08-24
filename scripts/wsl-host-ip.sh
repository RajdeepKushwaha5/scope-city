#!/usr/bin/env bash
# Prints how WSL should address a service listening on the Windows host.
#
# Needed because TrueForge runs in WSL (the standalone server segfaults on
# win32) while the scope proxy may run on Windows. WSL2 forwards localhost
# Windows -> WSL, but not the other way, so the proxy has to be advertised to
# TrueForge by an address WSL can actually reach.
set -uo pipefail

# Mirrored networking mode: localhost works in both directions.
if curl -s -m 2 -o /dev/null "http://127.0.0.1:${1:-8799}/"; then
  echo "127.0.0.1"
  exit 0
fi

# NAT mode: the default gateway is the Windows host.
gw=$(ip route show default | awk '{print $3}' | head -1)
if [ -n "${gw}" ]; then
  echo "${gw}"
  exit 0
fi

# Fallback: the DNS server WSL is handed is usually the host too.
awk '/^nameserver/ {print $2; exit}' /etc/resolv.conf
