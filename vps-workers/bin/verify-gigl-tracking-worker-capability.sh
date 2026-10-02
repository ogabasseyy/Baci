#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Same scoping as the poller entry: the smoke authenticates with the
# worker JWT only and must not inherit service-role material either.
# shellcheck disable=SC1091
. "$SCRIPT_DIR/gigl-tracking-scoped-env.sh"
gigl_tracking_scope_env
exec "$SCRIPT_DIR/run-web-script.sh" gigl-capability src/scripts/verify-gigl-tracking-worker-capability.ts
