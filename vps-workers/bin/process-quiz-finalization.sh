#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--once" ] && [ "$1" != "--loop" ]; }; then
  echo "[quiz-finalization] Usage: process-quiz-finalization.sh [--once|--loop]" >&2
  exit 1
fi

exec "$SCRIPT_DIR/run-web-script.sh" quiz-finalization src/scripts/process-quiz-finalization.ts "$@"
