#!/usr/bin/env bash
# Runs a repository script from the INSTALLED worker release as the worker
# user. Host verifiers execute worker code and its dependency tree, so they
# must never run under the deployment identity.
#
# Usage: run-as-worker.sh <repo-relative-script> [args...]
set -euo pipefail

WORKER_USER="${BACI_WORKER_USER:-baci-worker}"
ROOT="${BACI_WORKER_ROOT:-/srv/baci-worker}"
# Only these caller settings cross the identity boundary.
PASSED_VARIABLES=(
  BACI_EXPECTED_APP_SHA
  GIGL_ENV_FILE_AUTHORITATIVE
  NODE_ENV
  BACI_WORKER_PROFILE
)

fail() {
  echo "run-as-worker: $*" >&2
  exit 1
}

script="${1:-}"
shift || true
[[ "$script" =~ ^[A-Za-z0-9._/-]+\.sh$ && "$script" != *..* && "$script" != /* ]] ||
  fail "expected a repository-relative shell script path."
target="$ROOT/app-live/$script"
[ -f "$target" ] || fail "$script is not present in the installed release."
worker_uid="$(id -u "$WORKER_USER")" || fail "user $WORKER_USER does not exist."

settings=()
for name in "${PASSED_VARIABLES[@]}"; do
  if [ -n "${!name+x}" ]; then settings+=("$name=${!name}"); fi
done

exec sudo -n -u "$WORKER_USER" -- env -i \
  HOME="$ROOT" USER="$WORKER_USER" LOGNAME="$WORKER_USER" \
  PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 \
  XDG_RUNTIME_DIR="/run/user/$worker_uid" \
  VPS_WORKER_REMOTE_DIR="$ROOT/baci-workers" \
  BACI_WORKER_DEPLOY_LOCK="$ROOT/baci-workers/locks/release.lock" \
  ${settings[@]+"${settings[@]}"} \
  bash "$target" "$@"
