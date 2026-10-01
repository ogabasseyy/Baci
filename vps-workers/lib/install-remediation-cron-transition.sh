#!/usr/bin/env bash

install_remediation_cron_transition() {
  echo "==> Transactionally installing the remediation launch barrier"
  # shellcheck disable=SC2029 # The quoted values intentionally become remote argv.
  ssh "$VPS" "flock -x /tmp/baci-workers-deploy.lock bash -s -- '$REMOTE_DIR' '$STAGING_DIR' '$NODE_BIN' '$CODEX_REMEDIATOR_IMAGE' '$CODEX_CONTAINER_BIN' '${BACI_REMEDIATION_LEGACY_DRAIN_TIMEOUT_SECONDS:-60}' '${BACI_REMEDIATION_LEGACY_LOCK_WAIT_SECONDS:-900}' '${BACI_REMEDIATION_PROC_ROOT:-/proc}'" <<'REMOTE_SH'
set -euo pipefail

remote_dir="$1"
staging_dir="$2"
node_bin="$3"
codex_image="$4"
codex_container_bin="$5"
drain_timeout="$6"
lock_wait_seconds="$7"
proc_root="$8"
lock_dir="$remote_dir/locks"

global_lock_value="$(awk '
  {
    line = $0
    sub(/^[[:space:]]*/, "", line)
    if (line ~ /^export[[:space:]]+/) sub(/^export[[:space:]]+/, "", line)
    if (line !~ /^BACI_REMEDIATION_GLOBAL_LOCK_PATH[[:space:]]*=/) next
    sub(/^BACI_REMEDIATION_GLOBAL_LOCK_PATH[[:space:]]*=[[:space:]]*/, "", line)
    if (substr(line, 1, 1) == "\"") {
      line = substr(line, 2)
      closing_quote = index(line, "\"")
      if (closing_quote > 0) line = substr(line, 1, closing_quote - 1)
    } else {
      sub(/[[:space:]]+#.*$/, "", line)
      sub(/[[:space:]]+$/, "", line)
    }
    print line
    exit
  }
' "$remote_dir/.env" 2>/dev/null || true)"
global_lock_value="${global_lock_value%\"}"
global_lock_value="${global_lock_value#\"}"
global_lock_value="${global_lock_value%'}"
global_lock_value="${global_lock_value#'}"
if [ -z "$global_lock_value" ]; then
  global_lock_path="$lock_dir/error-remediator-global.lock"
elif [[ "$global_lock_value" = /* ]]; then
  global_lock_path="$global_lock_value"
else
  global_lock_path="$remote_dir/$global_lock_value"
fi
global_lock_parent="$(dirname "$global_lock_path")"

install -d -m 700 "$lock_dir"
if [ ! -d "$global_lock_parent" ]; then
  install -d -m 700 "$global_lock_parent"
fi
for lock_name in \
  vercel-error-remediator \
  sentry-mobile-error-remediator \
  remediation-codex-canary
do
  touch "$lock_dir/$lock_name.lock"
  chmod 600 "$lock_dir/$lock_name.lock"
done
touch "$global_lock_path"
chmod 600 "$global_lock_path"

# New entrypoints use the global lock, so holding it before installing their
# staged copies closes the direct-launch race before the legacy drain starts.
hold_lock() {
  local descriptor="$1" path="$2"
  BACI_REMEDIATION_LOCK_PATH="$path" \
    flock -w "$lock_wait_seconds" -x "$descriptor" || {
    echo "timed out waiting for $path" >&2
    exit 1
  }
}

exec 6>"$global_lock_path"
hold_lock 6 "$global_lock_path"
exec 7>"$lock_dir/vercel-error-remediator.lock"
hold_lock 7 "$lock_dir/vercel-error-remediator.lock"
exec 8>"$lock_dir/sentry-mobile-error-remediator.lock"
hold_lock 8 "$lock_dir/sentry-mobile-error-remediator.lock"
exec 9>"$lock_dir/remediation-codex-canary.lock"
hold_lock 9 "$lock_dir/remediation-codex-canary.lock"

python3 "$staging_dir/lib/remediation-cron-transition.py" \
  "$remote_dir" "$staging_dir" "$node_bin" "$codex_image" \
  "$codex_container_bin" "$drain_timeout" "$proc_root" "$global_lock_path"
REMOTE_SH
}
