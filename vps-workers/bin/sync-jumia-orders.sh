#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export BACI_WORKER_PROFILE="${BACI_WORKER_PROFILE:-jumia-order-sync}"
exec "$SCRIPT_DIR/run-web-script.sh" sync-jumia-orders src/scripts/sync-jumia-orders.ts
