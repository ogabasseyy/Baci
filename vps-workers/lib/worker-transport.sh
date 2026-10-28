#!/usr/bin/env bash
# Restricted transport adapter for worker deployment. SSH remains the default;
# local execution is enabled only for the verified runner/target identity.

WORKER_SSH_TARGET='bassey@82.29.190.219'
WORKER_TRANSPORT=ssh
WORKER_SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
WORKER_LOCAL_RUNTIME_DIR='/run/user/1001'
WORKER_LOCAL_BUS_ADDRESS='unix:path=/run/user/1001/bus'

worker_configure_deploy_target() {
  VPS="$WORKER_SSH_TARGET"
  REMOTE_DIR='/home/bassey/baci-workers'
  LOCK_DIR='/srv/baci-workers/locks'
  worker_configure_transport
}

worker_assert_local_identity() {
  local actual_user="$1" actual_host="$2" actual_dir="$3"
  local actual_home="$4" directory_owner="$5" parent_owner="$6"
  local actual_uid="$7" runtime_owner="$8"
  if [ "$actual_user" != 'bassey' ] || [ "$actual_host" != 'ogabassey' ] ||
    [ "$actual_dir" != '/home/bassey/baci-workers' ] ||
    [ "$actual_home" != '/home/bassey' ] ||
    [ "$directory_owner" != 'bassey' ] || [ "$parent_owner" != 'bassey' ] ||
    [ "$actual_uid" != '1001' ] || [ "$runtime_owner" != 'bassey' ]; then
    echo 'Refusing local worker deployment: runner identity does not match the verified VPS target.' >&2
    return 1
  fi
}

worker_configure_transport() {
  case "${BACI_WORKER_DEPLOY_LOCAL:-0}" in
    0|'')
      WORKER_TRANSPORT=ssh
      ;;
    1)
      local actual_user actual_uid actual_host actual_dir actual_home directory_owner parent_owner runtime_owner
      actual_user="$(PATH="$WORKER_SAFE_PATH" id -un)" || return 1
      actual_uid="$(PATH="$WORKER_SAFE_PATH" id -u)" || return 1
      actual_host="$(PATH="$WORKER_SAFE_PATH" hostname -s)" || return 1
      actual_dir="$(PATH="$WORKER_SAFE_PATH" readlink -f -- "$REMOTE_DIR")" || return 1
      actual_home="${HOME:-}"
      directory_owner="$(PATH="$WORKER_SAFE_PATH" stat -c '%U' -- "$REMOTE_DIR")" || return 1
      parent_owner="$(PATH="$WORKER_SAFE_PATH" stat -c '%U' -- "${REMOTE_DIR%/*}")" || return 1
      runtime_owner="$(PATH="$WORKER_SAFE_PATH" stat -c '%U' -- /run/user/1001)" || return 1
      if [ "${XDG_RUNTIME_DIR:-}" != "$WORKER_LOCAL_RUNTIME_DIR" ] ||
        [ "${DBUS_SESSION_BUS_ADDRESS:-}" != "$WORKER_LOCAL_BUS_ADDRESS" ]; then
        echo 'Refusing local worker deployment: runner user-bus environment does not match the verified socket.' >&2
        return 1
      fi
      worker_assert_local_identity "$actual_user" "$actual_host" "$actual_dir" \
        "$actual_home" "$directory_owner" "$parent_owner" "$actual_uid" "$runtime_owner" || return 1
      if [ ! -S /run/user/1001/bus ]; then
        echo 'Refusing local worker deployment: verified user systemd bus socket is unavailable.' >&2
        return 1
      fi
      WORKER_TRANSPORT=local
      ;;
    *)
      echo 'Refusing worker deployment: BACI_WORKER_DEPLOY_LOCAL must be unset, 0, or 1.' >&2
      return 1
      ;;
  esac
}

worker_exec_target() {
  local target="$1"
  shift
  if [ "$WORKER_TRANSPORT" = local ]; then
    if [ "$target" != "$WORKER_SSH_TARGET" ] || [ "$#" -ne 1 ]; then
      echo 'Refusing worker command: unexpected target or command shape.' >&2
      return 1
    fi
    # SSH does not forward coordinator credentials by default. Start with
    # an explicit, minimal environment so unanticipated workflow secrets
    # cannot flow into worker lifecycle scripts. Preserve only the host's
    # user-bus coordinates after validating that they refer to its standard
    # per-user socket.
    local -a safe_env=(HOME=/home/bassey USER=bassey LOGNAME=bassey
      PATH="$WORKER_SAFE_PATH" SHELL=/bin/bash
      XDG_RUNTIME_DIR="$WORKER_LOCAL_RUNTIME_DIR"
      DBUS_SESSION_BUS_ADDRESS="$WORKER_LOCAL_BUS_ADDRESS")
    /usr/bin/env -i "${safe_env[@]}" /bin/bash -c "$1"
  else
    command ssh "$target" "$@"
  fi
}

worker_rsync_to_stage() {
  local destination="$1"
  shift
  local normalized_destination="${destination%/}"
  local source
  local -a rsync_args expected_args
  if [ -z "${STAGING_DIR:-}" ] ||
    { [ "$normalized_destination" != "$STAGING_DIR" ] &&
      [ "$normalized_destination" != "$STAGING_DIR/bin/gigl-dotenv.sh" ]; }; then
    echo 'Refusing worker sync: destination is outside the current staging tree.' >&2
    return 1
  fi
  if [ "$WORKER_TRANSPORT" = local ]; then
    # The local destination is on the live host, so constrain both the
    # source and all rsync switches. In particular, --delete is safe only
    # for the unique staging target and the pinned checkout contents.
    if [ -z "${WORKER_ROOT:-}" ]; then
      echo 'Refusing worker sync: pinned checkout root is unavailable.' >&2
      return 1
    fi
    rsync_args=("$@")
    source="${rsync_args[${#rsync_args[@]}-1]:-}"
    if [ "$source" = "$WORKER_ROOT/" ] && [ "$normalized_destination" = "$STAGING_DIR" ]; then
      expected_args=(-av --delete '--exclude=.env*' --exclude=node_modules --exclude=logs --exclude=locks "$WORKER_ROOT/")
    elif [ "$source" = "$WORKER_ROOT/../.github/scripts/gigl-dotenv.sh" ] &&
      [ "$normalized_destination" = "$STAGING_DIR/bin/gigl-dotenv.sh" ]; then
      expected_args=(-av "$WORKER_ROOT/../.github/scripts/gigl-dotenv.sh")
    else
      echo 'Refusing worker sync: source or destination is outside the pinned staging operation.' >&2
      return 1
    fi
    if [ "${#rsync_args[@]}" -ne "${#expected_args[@]}" ]; then
      echo 'Refusing worker sync: unexpected rsync arguments.' >&2
      return 1
    fi
    local index
    for index in "${!expected_args[@]}"; do
      if [ "${rsync_args[index]}" != "${expected_args[index]}" ]; then
        echo 'Refusing worker sync: unsafe rsync option or source.' >&2
        return 1
      fi
    done
    /usr/bin/env -i HOME=/home/bassey USER=bassey LOGNAME=bassey \
      PATH="$WORKER_SAFE_PATH" /usr/bin/rsync "$@" "$destination"
  else
    command rsync "$@" "${VPS:-$WORKER_SSH_TARGET}:$destination"
  fi
}
