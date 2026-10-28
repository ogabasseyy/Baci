# Fixed-identity quiescence candidate. Deliberately unwired until the dedicated
# identities, worker crontab, system units, and trusted filesystem are verified.
# shellcheck shell=bash

strict_worker_release_quiesce() {
  local remote_dir="${1:-}"
  local expected_root='/srv/baci-workers'
  local expected_user='baci-worker'
  local expected_cron_user='bassey'
  local expected_uid expected_gid expected_lock_gid uid caller_uid cron_text status service lock_path lock_name global_path ordered_text
  local -a services=(baci-domain-event-router baci-event-delivery-worker baci-quiz-finalization)

  [ "$remote_dir" = "$expected_root" ] || { echo 'strict quiesce: unexpected worker root' >&2; return 1; }
  expected_uid="$(id -u "$expected_user" 2>/dev/null)" || { echo 'strict quiesce: worker identity unavailable' >&2; return 1; }
  expected_gid="$(id -g "$expected_user" 2>/dev/null)" || { echo 'strict quiesce: worker group unavailable' >&2; return 1; }
  expected_lock_gid="$(id -g baci-locks 2>/dev/null)" || { echo 'strict quiesce: shared lock group unavailable' >&2; return 1; }
  [[ "$expected_uid" =~ ^[1-9][0-9]*$ ]] || { echo 'strict quiesce: invalid worker uid' >&2; return 1; }
  [[ "$expected_gid" =~ ^[1-9][0-9]*$ ]] || { echo 'strict quiesce: invalid worker gid' >&2; return 1; }
  caller_uid="$(id -u)" || return 1
  [ "$caller_uid" = 0 ] || { echo 'strict quiesce: fixed system-unit control requires the trusted broker' >&2; return 1; }
  [ -d "$remote_dir" ] && [ ! -L "$remote_dir" ] && [ "$(realpath -e "$remote_dir" 2>/dev/null)" = "$expected_root" ] || {
    echo 'strict quiesce: worker root path is not trusted' >&2
    return 1
  }
  [ -d "$remote_dir/locks" ] && [ ! -L "$remote_dir/locks" ] || {
    echo 'strict quiesce: worker lock directory is not trusted' >&2
    return 1
  }
  [ "$(stat -c '%u:%g' "$remote_dir" 2>/dev/null)" = "0:$expected_lock_gid" ] &&
  [ "$(stat -c '%u:%g' "$remote_dir/locks" 2>/dev/null)" = "0:$expected_lock_gid" ] &&
    [ "$(stat -c '%a' "$remote_dir" 2>/dev/null)" = 710 ] &&
    [ "$(stat -c '%a' "$remote_dir/locks" 2>/dev/null)" = 710 ] || {
    echo 'strict quiesce: worker root ownership is unverified' >&2
    return 1
  }

  # State is intentionally global: the caller shell keeps these descriptors
  # open and the EXIT handler runs after this function's stack has returned.
  if [ "${_strict_worker_release_active:-0}" = 1 ]; then return 0; fi
  _strict_worker_release_active=1
  _strict_worker_release_expected_uid="$expected_uid"
  _strict_worker_release_services=()
  _strict_worker_release_fds=()
  _strict_worker_release_pids=()
  _strict_worker_release_ipc=()
  _strict_worker_release_prior_exit=''
  _strict_worker_release_deferred_global=''
  _strict_worker_release_fd=10
  _strict_worker_release_lock_dir="$remote_dir/locks"

  # Preserve a caller's EXIT action instead of replacing it. trap -p emits a
  # shell-quoted action; evaluate only that trusted shell-generated quoting.
  local prior_trap trap_payload
  prior_trap="$(trap -p EXIT)"
  if [ -n "$prior_trap" ]; then
    trap_payload="${prior_trap#trap -- }"
    trap_payload="${trap_payload% EXIT}"
    eval "_strict_worker_release_prior_exit=$trap_payload"
  fi
  trap '_strict_worker_release_on_exit' EXIT

  # Deployment cron remains owned by the release account; the isolated worker
  # is systemd-managed and intentionally has no crontab. Missing legacy
  # schedule evidence is not proof of idle.
  cron_text="$(crontab -u "$expected_cron_user" -l)" || {
    echo 'strict quiesce: release crontab lookup failed' >&2
    _strict_worker_release_cleanup
    return 1
  }
  global_path="$(_strict_worker_release_resolve_global_lock "$remote_dir" "$expected_user" "$expected_uid" "$expected_gid" "$expected_lock_gid")" || {
    echo 'strict quiesce: remediation global lock could not be resolved safely' >&2
    _strict_worker_release_cleanup
    return 1
  }
  if [ -e "$remote_dir/locks/gigl-tracking.lock" ] && [ "$global_path" -ef "$remote_dir/locks/gigl-tracking.lock" ]; then
    echo 'strict quiesce: remediation global lock aliases the inherited GIGL lock' >&2
    _strict_worker_release_cleanup
    return 1
  fi

  for service in "${services[@]}"; do
    if systemctl is-active -q "$service" >/dev/null 2>&1; then
      status=0
    else
      status=$?
    fi
    case "$status" in
      0)
        if systemctl stop "$service"; then
          _strict_worker_release_services+=("$service")
        else
          echo "strict quiesce: failed to stop $service" >&2
          _strict_worker_release_cleanup
          return 1
        fi
        ;;
      3) ;;
      *)
        echo "strict quiesce: systemd query failed for $service (status $status)" >&2
        _strict_worker_release_cleanup
        return 1
        ;;
    esac
  done

  # grep -o preserves every lock occurrence and its crontab order. Capture the
  # helper status explicitly; process-substitution status would be masked.
  local -a ordered=()
  ordered_text="$(_strict_worker_release_order_lock_paths "$cron_text" "$remote_dir/locks" "$global_path")"
  status=$?
  if [ "$status" -ne 0 ]; then
    echo 'strict quiesce: cron lock inventory could not be parsed' >&2
    _strict_worker_release_cleanup
    return 1
  fi
  while IFS= read -r lock_path; do
    [ -n "$lock_path" ] && ordered+=("$lock_path")
  done <<< "$ordered_text"

  # Append the configured remediation lock after every ordinary lock, even if
  # it lives outside locks/ or was absent from the cron/file inventory.
  for lock_path in "${ordered[@]}" "$global_path"; do
    lock_name="${lock_path##*/}"
    # The outer release transaction already holds the GIGL inode; flock is
    # not recursive across separately opened file descriptions.
    if [ -e "$remote_dir/locks/gigl-tracking.lock" ] && [ "$lock_path" -ef "$remote_dir/locks/gigl-tracking.lock" ]; then continue; fi
    if ! _strict_worker_release_hold_lock "$lock_path" "$expected_user" "$expected_uid" "$expected_gid" "$expected_lock_gid"; then
      echo "strict quiesce: failed to acquire $lock_name" >&2
      _strict_worker_release_cleanup
      return 1
    fi
  done
}

_strict_worker_release_order_lock_paths() {
  local cron_text="$1" lock_dir="$2" global_path="$3" lock_path lock_name seen=' '
  local -a candidates=() ordered=()
  local line rest
  while IFS= read -r line; do
    rest="$line"
    while [[ "$rest" =~ ([^[:space:]]*locks/([A-Za-z0-9_.-]+\.lock)) ]]; do
      local cron_lock_path="${BASH_REMATCH[1]}"
      lock_name="${BASH_REMATCH[2]}"
      if [ "$cron_lock_path" != "$lock_dir/$lock_name" ]; then
        echo 'strict quiesce: cron lock path is outside the trusted release namespace; migrate the schedule before release' >&2
        return 1
      fi
      candidates+=("$lock_dir/$lock_name")
      rest="${rest#*${cron_lock_path}}"
    done
  done <<< "$cron_text"
  for lock_path in "$lock_dir"/*.lock; do
    [ -e "$lock_path" ] || continue
    lock_name="${lock_path##*/}"
    case "$lock_name" in *[!A-Za-z0-9_.-]*|/*) echo 'strict quiesce: invalid lock filename' >&2; return 1;; esac
    candidates+=("$lock_path")
  done
  for lock_path in "${candidates[@]}"; do
    case "$seen" in *" $lock_path "*) continue;; esac
    seen="$seen$lock_path "
    if [ "$lock_path" = "$global_path" ] || { [ -e "$global_path" ] && [ -e "$lock_path" ] && [ "$lock_path" -ef "$global_path" ]; }; then continue; fi
    ordered+=("$lock_path")
  done
  printf '%s\n' "${ordered[@]}"
}

_strict_worker_release_resolve_global_lock() {
  local worker_root="$1" worker="$2" uid="$3" gid="$4" lock_gid="$5" reader="$1/bin/gigl-dotenv.sh" mode owner path parent base env_file
  local value path parent base
  [ -f "$reader" ] && [ ! -L "$reader" ] || return 1
  env_file="$worker_root/runtime/worker.env"
  [ -d "$worker_root/runtime" ] && [ ! -L "$worker_root/runtime" ] || return 1
  [ "$(stat -c '%u:%g:%a' "$worker_root/runtime" 2>/dev/null)" = "$uid:$gid:700" ] || return 1
  [ -f "$env_file" ] && [ ! -L "$env_file" ] || return 1
  [ "$(stat -c '%u:%g:%a:%h' "$env_file" 2>/dev/null)" = "$uid:$gid:600:1" ] || return 1
  value="$(runuser -u "$worker" -- /bin/bash -c '. "$1"; gigl_dotenv_value "$2" BACI_REMEDIATION_GLOBAL_LOCK_PATH' _ "$reader" "$env_file")" || return 1
  if [ -z "$value" ]; then path="$worker_root/locks/error-remediator-global.lock"
  elif [[ "$value" = /* ]]; then path="$value"
  else path="$worker_root/$value"
  fi
  [[ "$path" != *$'\n'* && "$path" != *$'\r'* ]] || return 1
  parent="$(dirname "$path")"
  base="${path##*/}"
  [[ "$base" =~ ^[A-Za-z0-9_.-]+\.lock$ ]] || return 1
  [ -d "$parent" ] && [ ! -L "$parent" ] || return 1
  parent="$(realpath -e "$parent")" || return 1
  [ "$parent" = "$worker_root/locks" ] || return 1
  [ "$(stat -c '%u:%g' "$parent" 2>/dev/null)" = "0:$lock_gid" ] || return 1
  mode="$(stat -c '%a' "$parent" 2>/dev/null)" || return 1
  [ "$mode" = 710 ] || return 1
  path="$parent/$base"
  [ -f "$path" ] && [ ! -L "$path" ] || return 1
  owner="$(stat -c '%u:%g:%a:%h' "$path" 2>/dev/null)" || return 1
  [ "$owner" = "0:$lock_gid:660:1" ] || return 1
  printf '%s\n' "$path"
}

_strict_worker_release_hold_lock() {
  local lock_path="$1" worker="$2" uid="$3" worker_gid="$4" lock_gid="$5" line
  # The keeper itself opens the pre-created inode with openat(O_NOFOLLOW),
  # verifies the descriptor, and retains that exact open-file-description while waiting
  # on its pipe. Bash never reopens a configurable path for flock.
  local ipc_dir ready_fifo release_fifo keeper_pid keeper_fd inherited_fd
  ipc_dir="$(mktemp -d)" || return 1
  chown "$uid:$worker_gid" "$ipc_dir" && chmod 700 "$ipc_dir" || { rm -rf "$ipc_dir"; return 1; }
  ready_fifo="$ipc_dir/ready"; release_fifo="$ipc_dir/release"
  mkfifo -m 600 "$ready_fifo" "$release_fifo" &&
    chown "$uid:$worker_gid" "$ready_fifo" "$release_fifo" || { rm -rf "$ipc_dir"; return 1; }
  (
    for inherited_fd in "${_strict_worker_release_fds[@]}"; do
      eval "exec ${inherited_fd}>&-" || exit 1
    done
    exec runuser -u "$worker" -- python3 "${BASH_SOURCE[0]%/*}/strict-lock-keeper.py" "$lock_path" "$uid" "$lock_gid" "$ready_fifo" "$release_fifo"
  ) &
  keeper_pid=$!
  if ! IFS= read -r -t 600 line < "$ready_fifo" || [ "$line" != READY ]; then
    kill "$keeper_pid" 2>/dev/null || true; wait "$keeper_pid" 2>/dev/null || true
    rm -rf "$ipc_dir"; return 1
  fi
  keeper_fd="${_strict_worker_release_fd:-10}"
  eval "exec ${keeper_fd}>\"$release_fifo\"" || { kill "$keeper_pid" 2>/dev/null || true; wait "$keeper_pid" 2>/dev/null || true; rm -rf "$ipc_dir"; return 1; }
  _strict_worker_release_fd=$((keeper_fd + 1))
  _strict_worker_release_pids+=("$keeper_pid")
  _strict_worker_release_fds+=("$keeper_fd")
  _strict_worker_release_ipc+=("$ipc_dir")
}

_strict_worker_release_cleanup() {
  [ "${_strict_worker_release_active:-0}" = 1 ] || return 0
  local service failed=0 index pid write_fd
  # Close every release pipe before waiting for any keeper. Later keeper
  # processes inherit earlier pipe descriptors; waiting one-at-a-time leaves
  # those duplicate writers open and prevents EOF from reaching that keeper.
  for ((index=0; index<${#_strict_worker_release_pids[@]}; index++)); do
    write_fd="${_strict_worker_release_fds[$index]}"
    eval "exec ${write_fd}>&-" || failed=1
  done
  for ((index=0; index<${#_strict_worker_release_pids[@]}; index++)); do
    pid="${_strict_worker_release_pids[$index]}"
    wait "$pid" || failed=1
    rm -rf "${_strict_worker_release_ipc[$index]}"
  done
  _strict_worker_release_fds=()
  _strict_worker_release_pids=()
  _strict_worker_release_ipc=()
  for service in "${_strict_worker_release_services[@]}"; do
    systemctl start "$service" || failed=1
  done
  _strict_worker_release_services=()
  _strict_worker_release_active=0
  return "$failed"
}

_strict_worker_release_on_exit() {
  local original_status=$?
  local cleanup_status=0
  # Disable this handler before explicitly exiting below, so Bash cannot
  # recurse while we preserve a failed cleanup result as the process status.
  trap - EXIT
  _strict_worker_release_cleanup || cleanup_status=$?
  if [ -n "${_strict_worker_release_prior_exit:-}" ]; then
    eval "$_strict_worker_release_prior_exit"
  fi
  # A successful EOF is confirmed only when every lock keeper exited and each
  # service stopped by this helper restarted. Preserve an earlier failure too.
  if [ "$original_status" -ne 0 ]; then
    exit "$original_status"
  fi
  exit "$cleanup_status"
}
