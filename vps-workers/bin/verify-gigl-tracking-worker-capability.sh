#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Same scoping as the poller entry: the smoke authenticates with the
# worker JWT only and must not inherit service-role material either.
# shellcheck disable=SC1091
. "$SCRIPT_DIR/gigl-tracking-scoped-env.sh"
# The smoke certifies the INSTALLED dotenv: file-authoritative mode makes
# the filter ignore caller exports, so a variable lingering in the runner
# environment can never certify one project/token while cron runs another.
export GIGL_ENV_FILE_AUTHORITATIVE=1
gigl_tracking_scope_env
# The helper execs run-web-script.sh under a constructed allowlist
# environment (env -i): caller-exported secrets never reach the child.
gigl_tracking_exec_scoped "$SCRIPT_DIR/run-web-script.sh" gigl-capability src/scripts/verify-gigl-tracking-worker-capability.ts
