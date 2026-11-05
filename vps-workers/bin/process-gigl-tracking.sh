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
if [ -f "$SCRIPT_DIR/gigl-cache-lock-exec.py" ] && env -i PATH="$PATH" python3 -I -c 'import pathlib,sys; compile(pathlib.Path(sys.argv[1]).read_bytes(), sys.argv[1], "exec")' "$SCRIPT_DIR/gigl-cache-lock-exec.py" 2>/dev/null; then
  gigl_tracking_exec_scoped python3 "$SCRIPT_DIR/gigl-cache-lock-exec.py" "$SCRIPT_DIR/run-web-script.sh" gigl-tracking src/scripts/process-gigl-tracking.ts
else
  # An older/incomplete worker install remains available without the cache.
  gigl_tracking_exec_scoped "$SCRIPT_DIR/run-web-script.sh" gigl-tracking src/scripts/process-gigl-tracking.ts
fi
