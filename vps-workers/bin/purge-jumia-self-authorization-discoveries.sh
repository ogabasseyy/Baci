#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export BACI_WORKER_PROFILE="${BACI_WORKER_PROFILE:-purge-jumia-self-authorization-discoveries}"
exec "$SCRIPT_DIR/run-web-script.sh" purge-jumia-self-authorization-discoveries src/scripts/purge-jumia-self-authorization-discoveries.ts "$@"
