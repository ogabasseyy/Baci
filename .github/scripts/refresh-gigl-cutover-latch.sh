#!/usr/bin/env bash
# Post-migration capability refresh only. Never run from deploy preparation:
# the restricted database wrappers must exist before this smoke is meaningful.
# Hold the same deploy lock as worker promotion, then the tracking cron lock.
set -euo pipefail

fail() {
  echo "refresh-gigl-cutover-latch: $1" >&2
  exit 1
}

expected_sha="${BACI_EXPECTED_APP_SHA:-}"
[[ "$expected_sha" =~ ^[0-9a-f]{40}$ ]] || fail "BACI_EXPECTED_APP_SHA must be an explicit lowercase 40-character SHA."
[ "$#" -eq 0 ] || fail "This helper accepts environment configuration only."
remote_dir="${VPS_WORKER_REMOTE_DIR:-/home/bassey/baci-workers}"
# Test-only isolation; production always shares the deploy.sh promotion lock.
deploy_lock="${BACI_GIGL_LATCH_TEST_DEPLOY_LOCK:-/tmp/baci-workers-deploy.lock}"
# The canonical poll allows 120 seconds plus 30 seconds termination grace.
lock_wait="${BACI_GIGL_LATCH_LOCK_WAIT_SECONDS:-180}"
[[ "$lock_wait" =~ ^[1-9][0-9]{0,2}$ ]] && [ "$lock_wait" -le 300 ] ||
  fail "Lock wait must be an integer from 1 to 300 seconds."
command -v flock >/dev/null 2>&1 || fail "flock is required."
[ -d "$remote_dir/locks" ] || fail "Installed worker lock directory is missing."

script_dir="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
verifier="$script_dir/../../vps-workers/bin/verify-gigl-direct-workers-installed.sh"
export BACI_EXPECTED_APP_SHA="$expected_sha"
export VPS_WORKER_REMOTE_DIR="$remote_dir"
export GIGL_ENV_FILE_AUTHORITATIVE=1

exec 9>"$deploy_lock"
flock -w "$lock_wait" 9 || fail "Timed out acquiring the deployment lock."
exec 8>"$remote_dir/locks/gigl-tracking.lock"
flock -w "$lock_wait" 8 || fail "Timed out acquiring the tracking lock."

# Never relay subprocess output: capability failures may contain credentials.
verify_installation() {
  bash "$verifier" --skip-live-smoke >/dev/null 2>&1 ||
    fail "Installed worker validation failed $1 smoke; latch unchanged."
}
resolve_identity() {
  local identity pattern
  pattern='^(enabled|disabled) [0-9a-f]{64}$'
  identity="$(bash "$script_dir/resolve-gigl-latch-identity.sh" "$remote_dir" 2>/dev/null)" ||
    return 1
  [[ "$identity" =~ $pattern ]] || return 1
  printf '%s' "$identity"
}

verify_installation before
identity_before="$(resolve_identity)" || fail "Installed identity is invalid; latch unchanged."
if bash "$script_dir/smoke-gigl-worker-capability.sh" >/dev/null 2>&1; then
  :
else
  smoke_status=$?
  echo "refresh-gigl-cutover-latch: Capability smoke failed (exit $smoke_status); latch unchanged." >&2
  exit "$smoke_status"
fi
verify_installation after
identity_after="$(resolve_identity)" || fail "Installed identity is invalid after smoke; latch unchanged."
[ "$identity_before" = "$identity_after" ] ||
  fail "Installed identity changed during smoke; latch unchanged."

latch="$remote_dir/.gigl-capability-smoke-ok"
[ ! -d "$latch" ] || fail "Latch destination is a directory."
temporary_latch=""
cleanup() {
  if [ -n "$temporary_latch" ]; then rm -f -- "$temporary_latch"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
umask 077
temporary_latch="$(mktemp "$remote_dir/.gigl-capability-smoke-ok.XXXXXX")"
chmod 600 "$temporary_latch"
printf '%s:%s:%s\n' "${identity_after%% *}" "$expected_sha" "${identity_after#* }" > "$temporary_latch"
mv -f -- "$temporary_latch" "$latch"
temporary_latch=""
echo "refresh-gigl-cutover-latch: Capability verified and latch refreshed."
