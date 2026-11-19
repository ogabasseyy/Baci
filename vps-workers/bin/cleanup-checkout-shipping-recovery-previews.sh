#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export BACI_WORKER_PROFILE="${BACI_WORKER_PROFILE:-cleanup-checkout-shipping-recovery-previews}"
exec "$SCRIPT_DIR/run-web-script.sh" cleanup-checkout-shipping-recovery-previews src/scripts/cleanup-checkout-shipping-recovery-previews.ts "$@"
