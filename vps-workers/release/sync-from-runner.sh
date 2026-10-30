#!/usr/bin/env bash
# Runs on the production deploy runner (the deployment identity). It hands
# the exact release SHA to worker-release.sh under the dedicated worker
# user and, on first use, retires the legacy workers that ran as this user.
#
# Usage: sync-from-runner.sh <sha>
set -euo pipefail
umask 077

WORKER_USER="${BACI_WORKER_USER:-baci-worker}"
ROOT="${BACI_WORKER_ROOT:-/srv/baci-worker}"
LEGACY_DIR="${BACI_LEGACY_WORKER_DIR:-$HOME/baci-workers}"
LEGACY_BACKUP_DIR="${BACI_LEGACY_BACKUP_DIR:-$HOME/.local/state/baci}"
LOCK_WAIT="${BACI_WORKER_LOCK_WAIT_SECONDS:-180}"
SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RELEASE_SCRIPT="$SCRIPT_DIR/worker-release.sh"
CRON_BLOCK_START='# >>> baci-workers >>>'
CRON_BLOCK_END='# <<< baci-workers <<<'
LEGACY_UNITS=(
  baci-vercel-log-drain-receiver.service
  baci-ai-storefront-trigger.service
  baci-import-job-trigger.service
  baci-domain-event-router.service
  baci-event-delivery-worker.service
  baci-quiz-finalization.service
)

fail() {
  echo "sync-from-runner: $*" >&2
  exit 1
}

sha="${1:-}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || fail "expected a lowercase 40-character commit SHA."
[ "$(id -un)" != "$WORKER_USER" ] || fail "run this as the deployment user, not $WORKER_USER."

# Host readiness: provision-host.sh (run once as root) creates all of this.
worker_uid="$(id -u "$WORKER_USER" 2>/dev/null)" ||
  fail "user $WORKER_USER does not exist; run vps-workers/release/provision-host.sh as root."
sudo -n -u "$WORKER_USER" true 2>/dev/null ||
  fail "this user cannot switch to $WORKER_USER without a password; run provision-host.sh as root."
[ -r "$ROOT/baci-workers/.env" ] ||
  fail "the worker environment is not readable at $ROOT/baci-workers/.env; run provision-host.sh as root."
RUNTIME_DIR="${BACI_WORKER_RUNTIME_DIR:-/run/user/$worker_uid}"
[ -d "$RUNTIME_DIR" ] ||
  fail "$WORKER_USER has no user manager; enable lingering with provision-host.sh."

run_release() {
  # env -i: nothing from the runner environment (tokens, GITHUB_*, PATH
  # entries) reaches the worker user. The script body arrives on stdin
  # because the runner checkout is private to the deployment user (the
  # redirect is intentionally opened by this user).
  # shellcheck disable=SC2024
  sudo -n -u "$WORKER_USER" -- env -i \
    HOME="$ROOT" USER="$WORKER_USER" LOGNAME="$WORKER_USER" \
    PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 \
    XDG_RUNTIME_DIR="$RUNTIME_DIR" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=$RUNTIME_DIR/bus" \
    BACI_WORKER_ROOT="$ROOT" BACI_WORKER_LOCK_WAIT_SECONDS="$LOCK_WAIT" \
    bash -s -- "$@" < "$RELEASE_SCRIPT"
}

legacy_schedule_active() {
  crontab -l 2>/dev/null | grep -Fqx "$CRON_BLOCK_START"
}

# Stops the legacy schedule and services, keeping a restorable copy of the
# full crontab. Fails unless every legacy service is down and no legacy GIGL
# tick is running, so the two identities never process work concurrently.
stop_legacy() {
  local backup="$1" unit
  # Called from a conditional, where errexit is ignored: check each step and
  # name the one that failed.
  crontab -l > "$backup" || { legacy_step_failed "saving the crontab backup"; return 1; }
  grep -Fqx "$CRON_BLOCK_START" "$backup" || { legacy_step_failed "finding the worker block in the backup"; return 1; }
  awk -v start="$CRON_BLOCK_START" -v end="$CRON_BLOCK_END" '
    $0 == start { skip = 1; next }
    $0 == end { skip = 0; next }
    !skip { print }
  ' "$backup" | crontab - || { legacy_step_failed "removing the worker block from the crontab"; return 1; }
  ! legacy_schedule_active || { legacy_step_failed "confirming the worker block is gone"; return 1; }
  systemctl --user stop "${LEGACY_UNITS[@]}" || { legacy_step_failed "stopping the legacy services"; return 1; }
  systemctl --user disable --quiet "${LEGACY_UNITS[@]}" || { legacy_step_failed "disabling the legacy services"; return 1; }
  for unit in "${LEGACY_UNITS[@]}"; do
    if systemctl --user is-active --quiet "$unit"; then { legacy_step_failed "$unit is still active"; return 1; }; fi
  done
  if [ -d "$LEGACY_DIR/locks" ]; then
    flock -w "$LOCK_WAIT" "$LEGACY_DIR/locks/gigl-tracking.lock" true ||
      { legacy_step_failed "waiting for the legacy GIGL tick"; return 1; }
  fi
}

legacy_step_failed() {
  echo "sync-from-runner: legacy retirement step failed: $1." >&2
}

restore_legacy() {
  local backup="$1"
  crontab "$backup"
  systemctl --user enable --now --quiet "${LEGACY_UNITS[@]}" 2>/dev/null || true
  echo "sync-from-runner: restored the legacy worker schedule from $backup." >&2
}

# Actions job steps do not inherit the runner listener's user-bus settings,
# so point `systemctl --user` at this user's manager explicitly.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

run_release build "$sha"

legacy_backup=""
if legacy_schedule_active; then
  mkdir -p "$LEGACY_BACKUP_DIR"
  legacy_backup="$LEGACY_BACKUP_DIR/legacy-worker-crontab.$(date -u +%Y%m%dT%H%M%SZ)"
  echo "sync-from-runner: retiring the legacy worker schedule (backup: $legacy_backup)."
  if ! stop_legacy "$legacy_backup"; then
    restore_legacy "$legacy_backup"
    fail "the legacy workers did not stop cleanly; nothing was activated."
  fi
fi

if ! run_release activate "$sha"; then
  if [ -n "$legacy_backup" ]; then restore_legacy "$legacy_backup"; fi
  fail "activation of $sha failed."
fi

installed="$(run_release status)"
[ "$installed" = "$sha" ] || fail "installed release is ${installed:-missing}, expected $sha."
echo "sync-from-runner: workers are running $sha as $WORKER_USER."
