#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export BACI_WORKER_PROFILE="${BACI_WORKER_PROFILE:-import-jobs}"
exec "$SCRIPT_DIR/run-web-script.sh" process-import-jobs src/scripts/process-import-jobs.ts
