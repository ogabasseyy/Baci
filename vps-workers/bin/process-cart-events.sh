#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--once" ] && [ "$1" != "--loop" ]; }; then
  echo "[cart-events] Usage: process-cart-events.sh [--once|--loop]" >&2
  exit 1
fi
exec "$SCRIPT_DIR/run-web-script.sh" cart-events src/scripts/process-cart-events.ts "$@"
