#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Scope the poller environment BEFORE anything provider-facing runs: the
# shared worker .env also holds the service-role key and other workers'
# credentials, which must never reach this process (see the filter).
# shellcheck disable=SC1091
. "$SCRIPT_DIR/gigl-tracking-scoped-env.sh"
gigl_tracking_scope_env
# The helper execs run-web-script.sh under a constructed allowlist
# environment (env -i): caller-exported secrets never reach the child.
gigl_tracking_exec_scoped "$SCRIPT_DIR/run-web-script.sh" gigl-tracking src/scripts/process-gigl-tracking.ts
