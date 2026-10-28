#!/usr/bin/env bash
# Transactional cutover of the GIGL tracking schedule from bassey's cron to
# a systemd timer running under baci-worker. This intentionally does not
# provision accounts, move secrets, or modify a live checkout.
set -euo pipefail

readonly WORKER_USER=baci-worker
readonly WORKER_ROOT=/srv/baci-workers
readonly UNIT_DIR=/etc/systemd/system
readonly BACKUP_ROOT=/var/lib/baci-workers/gigl-tracking-migration-backups
readonly SERVICE_NAME=baci-gigl-tracking.service
readonly TIMER_NAME=baci-gigl-tracking.timer
readonly LEGACY_USER=bassey
readonly LOCK_DRAIN_TIMEOUT_SECONDS=180
HELD_LOCK_FDS=()

usage() {
  echo "Usage: sudo $0 migrate | rollback <backup-directory>" >&2
}

fail() { echo "GIGL service migration: $*" >&2; exit 1; }

require_root() {
  [[ "$(id -u)" == 0 ]] || fail 'must run as root'
}

require_root_owned_directory() {
  local path="$1" label="$2" owner_mode uid gid mode worker_gid
  [[ -d "$path" && ! -L "$path" ]] || fail "$label must be a real directory"
  owner_mode="$(stat -c '%u:%g:%a' -- "$path")"
  IFS=: read -r uid gid mode <<< "$owner_mode"
  [[ "$uid" == 0 && "$mode" =~ ^[0-7]{3,4}$ ]] || fail "$label must be root-owned"
  (( (8#$mode & 022) == 0 )) || fail "$label must not be group- or world-writable"
  worker_gid="$(id -g "$WORKER_USER")"
  if [[ "$gid" == "$worker_gid" ]]; then
    (( (8#$mode & 010) != 0 )) || fail "$label must be traversable by $WORKER_USER"
  else
    (( (8#$mode & 001) != 0 )) || fail "$label must be traversable by $WORKER_USER"
  fi
}

check_layout() {
  id "$WORKER_USER" >/dev/null 2>&1 || fail "missing $WORKER_USER account"
  [[ -d "$WORKER_ROOT/current/bin" ]] || fail "missing $WORKER_ROOT/current/bin"
  [[ -x "$WORKER_ROOT/current/bin/process-gigl-tracking.sh" ]] || fail 'GIGL wrapper is not executable'
  [[ -x "$WORKER_ROOT/current/bin/verify-gigl-tracking-worker-capability.sh" ]] || fail 'capability verifier is not executable'
  require_root_owned_directory "$WORKER_ROOT" 'worker root'
  require_root_owned_directory "$WORKER_ROOT/releases" 'worker releases directory'
  local active_release
  active_release="$(readlink -f -- "$WORKER_ROOT/current")"
  [[ "$active_release" == "$WORKER_ROOT/releases/"* && "$(dirname -- "$active_release")" == "$WORKER_ROOT/releases" ]] ||
    fail "current worker release must resolve to a direct child of the releases directory (resolved path: $active_release)"
  require_root_owned_directory "$active_release" 'active worker release'
  [[ -r "$WORKER_ROOT/runtime/worker.env" ]] || fail 'worker runtime env file is missing or unreadable'
  [[ "$(stat -c '%U:%G:%a' "$WORKER_ROOT/runtime/worker.env")" == "$WORKER_USER:$WORKER_USER:600" ]] ||
    fail 'runtime env must be owned by baci-worker:baci-worker with mode 0600'
  [[ "$(id -gn "$WORKER_USER")" == "$WORKER_USER" ]] || fail 'baci-worker primary group must be baci-worker'
  local path expected_mode
  for path in "$WORKER_ROOT/locks" "$WORKER_ROOT/logs" "$WORKER_ROOT/home"; do
    [[ -d "$path" ]] || fail "missing worker directory: $path"
    expected_mode=750
    [[ "$path" != "$WORKER_ROOT/home" ]] || expected_mode=700
    [[ "$(stat -c '%U:%G:%a' "$path")" == "$WORKER_USER:$WORKER_USER:$expected_mode" ]] ||
      fail "worker directory has unsafe ownership or mode: $path"
  done
  [[ -f "$WORKER_ROOT/locks/gigl-tracking.lock" && ! -L "$WORKER_ROOT/locks/gigl-tracking.lock" ]] ||
    fail 'new GIGL tracking lock must be a pre-created regular file'
  if id -nG "$WORKER_USER" | tr ' ' '\n' | grep -Eq '^(sudo|docker)$'; then
    fail "$WORKER_USER must not belong to sudo or docker"
  fi
}

acquire_drain_lock() {
  local lock_path="$1" label="$2" lock_fd="$3"
  [[ -f "$lock_path" && ! -L "$lock_path" ]] || fail "$label lock must be a regular, non-symlink file"
  case "$lock_fd" in
    8) exec 8>>"$lock_path" || fail "cannot open $label lock" ;;
    9) exec 9>>"$lock_path" || fail "cannot open $label lock" ;;
    *) fail 'internal lock descriptor is invalid' ;;
  esac
  if ! flock -x -w "$LOCK_DRAIN_TIMEOUT_SECONDS" "$lock_fd"; then
    eval "exec ${lock_fd}>&-"
    fail "timed out draining $label lock"
  fi
  HELD_LOCK_FDS+=("$lock_fd")
}

release_drain_locks() {
  local lock_fd
  for lock_fd in "${HELD_LOCK_FDS[@]}"; do
    eval "exec ${lock_fd}>&-"
  done
  HELD_LOCK_FDS=()
}

legacy_gigl_lock_path() {
  local cron="$1" lock_path
  lock_path="$(printf '%s\n' "$cron" | awk '$1 == "*/5" && $2 == "*" && $3 == "*" && $4 == "*" && $5 == "*" && $6 == "flock" && $7 == "-n" && $9 == "bash" && /\/bin\/process-gigl-tracking\.sh/ { print $8 }')"
  [[ "$lock_path" == /*/locks/gigl-tracking.lock && "$lock_path" != "$WORKER_ROOT/locks/gigl-tracking.lock" ]] ||
    fail 'legacy GIGL cron must use an explicit separate locks/gigl-tracking.lock path'
  [[ -f "$lock_path" && ! -L "$lock_path" ]] || fail 'legacy GIGL lock must already exist as a regular, non-symlink file'
  printf '%s' "$lock_path"
}

render_service() {
  cat <<EOF
[Unit]
Description=Baci GIGL tracking poller
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$WORKER_USER
Group=$WORKER_USER
WorkingDirectory=$WORKER_ROOT/current
Environment=HOME=$WORKER_ROOT/home
Environment=NODE_ENV=production
Environment=BACI_WORKER_PROFILE=gigl-tracking
Environment=BACI_WORKER_ENV=$WORKER_ROOT/runtime/worker.env
Environment=GIGL_ENV_FILE_AUTHORITATIVE=1
ExecStart=/usr/bin/flock -n $WORKER_ROOT/locks/gigl-tracking.lock /usr/bin/timeout --signal=TERM --kill-after=30s 2m $WORKER_ROOT/current/bin/process-gigl-tracking.sh
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$WORKER_ROOT/locks $WORKER_ROOT/logs
TimeoutStartSec=150
EOF
}

render_timer() {
  cat <<EOF
[Unit]
Description=Run Baci GIGL tracking every five minutes

[Timer]
OnCalendar=*:0/5
Persistent=true
Unit=$SERVICE_NAME

[Install]
WantedBy=timers.target
EOF
}

migrate() {
  require_root
  check_layout
  [[ ! -e "$UNIT_DIR/$SERVICE_NAME" && ! -e "$UNIT_DIR/$TIMER_NAME" ]] || fail 'systemd unit already exists; refusing to overwrite'

  local old_crontab matching_count canonical_count tmpdir old_lock_path
  umask 077
  local backup_parent="${BACKUP_ROOT%/*}"
  [[ ! -L "$backup_parent" ]] || fail 'migration backup parent must not be a symlink'
  if [[ -e "$backup_parent" ]]; then
    [[ -d "$backup_parent" ]] || fail 'migration backup parent is not a directory'
    [[ "$(stat -c '%U:%G:%a' "$backup_parent")" == 'root:root:755' ]] ||
      fail 'migration backup parent must be owned by root with mode 0755'
  else
    mkdir -m 0755 -- "$backup_parent"
  fi
  [[ ! -L "$BACKUP_ROOT" ]] || fail 'migration backup directory must not be a symlink'
  if [[ -e "$BACKUP_ROOT" ]]; then
    [[ -d "$BACKUP_ROOT" ]] || fail 'migration backup path is not a directory'
    [[ "$(stat -c '%U:%G:%a' "$BACKUP_ROOT")" == 'root:root:700' ]] ||
      fail 'migration backup directory must be owned by root with mode 0700'
  else
    mkdir -m 0700 -- "$BACKUP_ROOT"
  fi
  tmpdir="$BACKUP_ROOT/gigl-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir -m 0700 "$tmpdir"
  crontab -u "$LEGACY_USER" -l > "$tmpdir/bassey.crontab" 2>/dev/null || fail "cannot read $LEGACY_USER crontab"
  old_crontab="$(cat "$tmpdir/bassey.crontab")"
  matching_count="$(printf '%s\n' "$old_crontab" | awk '/\/bin\/process-gigl-tracking\.sh/ && !/^#/ { n++ } END { print n+0 }')"
  [[ "$matching_count" == 1 ]] || fail "expected exactly one active legacy GIGL cron entry; found $matching_count"
  canonical_count="$(printf '%s\n' "$old_crontab" | awk '$1 == "*/5" && $2 == "*" && $3 == "*" && $4 == "*" && $5 == "*" && /\/bin\/process-gigl-tracking\.sh/ && !/^#/ { n++ } END { print n+0 }')"
  [[ "$canonical_count" == 1 ]] || fail 'legacy GIGL cron entry is not the expected five-minute schedule'
  printf '%s\n' "$old_crontab" | grep -Fq "$WORKER_ROOT" && fail 'legacy cron unexpectedly points at the new worker root'
  old_lock_path="$(legacy_gigl_lock_path "$old_crontab")"

  render_service > "$tmpdir/$SERVICE_NAME"
  render_timer > "$tmpdir/$TIMER_NAME"
  chmod 0600 "$tmpdir"/*

  # Install disabled first. Drain and hold the old cron lock across the
  # schedule switch so a cron invocation already in flight has completed and
  # any cron tick racing the crontab update cannot enter the poller.
  local installed_service=0 installed_timer=0
  rollback_on_error() {
    local status=$?
    local current_crontab="$tmpdir/bassey.crontab.rollback-check"
    local remove_units=1
    trap - ERR
    if (( installed_timer != 0 )) && ! systemctl disable --now "$TIMER_NAME" >/dev/null 2>&1; then
      remove_units=0
      echo 'GIGL service migration: could not stop the new timer; retaining its unit files for operator recovery' >&2
    elif (( installed_timer != 0 )) && ! acquire_drain_lock "$WORKER_ROOT/locks/gigl-tracking.lock" 'new GIGL' 8; then
      remove_units=0
      echo 'GIGL service migration: could not drain the new GIGL service; retaining its unit files and legacy schedule for operator recovery' >&2
    fi
    if (( remove_units != 0 )) && [[ -f "$tmpdir/bassey.crontab.migrated" ]] &&
      crontab -u "$LEGACY_USER" -l > "$current_crontab" 2>/dev/null; then
      if cmp -s "$current_crontab" "$tmpdir/bassey.crontab.migrated"; then
        crontab -u "$LEGACY_USER" "$tmpdir/bassey.crontab" || true
      elif ! cmp -s "$current_crontab" "$tmpdir/bassey.crontab"; then
        echo 'GIGL service migration: crontab changed during rollback; preserving current operator state' >&2
      fi
    fi
    if (( remove_units != 0 )); then
      (( installed_timer == 0 )) || rm -f -- "$UNIT_DIR/$TIMER_NAME"
      (( installed_service == 0 )) || rm -f -- "$UNIT_DIR/$SERVICE_NAME"
      if (( installed_service != 0 || installed_timer != 0 )); then
        systemctl daemon-reload >/dev/null 2>&1 || true
      fi
    fi
    rm -f -- "$current_crontab"
    release_drain_locks
    exit "$status"
  }
  trap rollback_on_error ERR
  install -o root -g root -m 0644 "$tmpdir/$SERVICE_NAME" "$UNIT_DIR/$SERVICE_NAME"
  installed_service=1
  install -o root -g root -m 0644 "$tmpdir/$TIMER_NAME" "$UNIT_DIR/$TIMER_NAME"
  installed_timer=1
  systemctl daemon-reload

  acquire_drain_lock "$old_lock_path" 'legacy GIGL' 9

  # Drop only the single verified GIGL line; preserve every unrelated entry.
  printf '%s\n' "$old_crontab" | awk '!(/\/bin\/process-gigl-tracking\.sh/ && !/^#/)' > "$tmpdir/bassey.crontab.migrated"
  chmod 0600 "$tmpdir/bassey.crontab.migrated"
  crontab -u "$LEGACY_USER" "$tmpdir/bassey.crontab.migrated"
  systemctl enable --now "$TIMER_NAME"
  release_drain_locks
  trap - ERR
  echo "GIGL service migration installed. Rollback snapshot: $tmpdir"
}

rollback() {
  require_root
  [[ "$#" == 1 ]] || { usage; exit 2; }
  local backup="$1"
  local backup_parent="${BACKUP_ROOT%/*}"
  [[ "$backup" == "$BACKUP_ROOT/gigl-"* ]] || fail 'backup must be inside the GIGL migration backup directory'
  [[ "$(dirname -- "$backup")" == "$BACKUP_ROOT" && ! -L "$backup_parent" && ! -L "$BACKUP_ROOT" && ! -L "$backup" ]] ||
    fail 'backup must be a direct, non-symlink child of the GIGL migration backup directory'
  [[ "$(stat -c '%U:%G:%a' "$backup_parent")" == 'root:root:755' ]] || fail 'migration backup parent ownership or mode is unsafe'
  [[ "$(stat -c '%U:%G:%a' "$BACKUP_ROOT")" == 'root:root:700' ]] || fail 'migration backup directory ownership or mode is unsafe'
  [[ -f "$backup/bassey.crontab" && -f "$backup/$SERVICE_NAME" && -f "$backup/$TIMER_NAME" ]] || fail 'backup is incomplete'
  [[ "$(stat -c '%U:%G:%a' "$backup")" == 'root:root:700' ]] || fail 'backup directory ownership or mode is unsafe'
  [[ -f "$backup/bassey.crontab.migrated" ]] || fail 'migrated crontab snapshot is missing'
  cmp -s "$UNIT_DIR/$SERVICE_NAME" "$backup/$SERVICE_NAME" || fail 'service unit changed since migration; refusing rollback'
  cmp -s "$UNIT_DIR/$TIMER_NAME" "$backup/$TIMER_NAME" || fail 'timer unit changed since migration; refusing rollback'
  local current_crontab
  current_crontab="$(crontab -u "$LEGACY_USER" -l 2>/dev/null)" || fail "cannot read $LEGACY_USER crontab"
  printf '%s\n' "$current_crontab" > "$backup/current-crontab-check"
  if ! cmp -s "$backup/current-crontab-check" "$backup/bassey.crontab.migrated"; then
    rm -f "$backup/current-crontab-check"
    fail 'bassey crontab changed since migration; refusing to overwrite operator changes'
  fi
  rm -f "$backup/current-crontab-check"

  old_lock_path="$(legacy_gigl_lock_path "$(cat "$backup/bassey.crontab")")"
  # Stop future timer ticks and drain any active service before restoring cron.
  # Then hold the legacy lock while restoring its schedule so no old invocation
  # can overlap a just-finished systemd run.
  acquire_drain_lock "$WORKER_ROOT/locks/gigl-tracking.lock" 'new GIGL' 8
  systemctl disable --now "$TIMER_NAME" >/dev/null 2>&1 || {
    release_drain_locks
    fail 'could not stop the GIGL timer; legacy crontab remains disabled'
  }
  acquire_drain_lock "$old_lock_path" 'legacy GIGL' 9
  crontab -u "$LEGACY_USER" "$backup/bassey.crontab" || {
    release_drain_locks
    fail 'could not restore the legacy crontab; timer is stopped'
  }
  rm -f "$UNIT_DIR/$SERVICE_NAME" "$UNIT_DIR/$TIMER_NAME"
  systemctl daemon-reload
  release_drain_locks
  echo 'GIGL timer stopped and exact prior bassey crontab restored. Verify one poller and the recorded worker SHA before releasing any deployment lock.'
}

case "${1:-}" in
  migrate) [[ "$#" == 1 ]] || { usage; exit 2; }; migrate ;;
  rollback) shift; rollback "$@" ;;
  *) usage; exit 2 ;;
esac
