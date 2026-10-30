#!/usr/bin/env bash
# Fixed service supervisor. EOF is always an abort; only HEALTHY or RESTORE
# after the broker's durable state write may leave a release running.
set -euo pipefail

readonly python=/usr/bin/python3
readonly recovery_module=worker_release_recovery_latch
readonly helper_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly services=(baci-domain-event-router baci-event-delivery-worker baci-quiz-finalization)
declare -a active_services=()
authorized_exit=0

recovery() {
  "$python" -I "$helper_root/${recovery_module}.py" "$@"
}

stop_active() {
  local service failed=0
  for service in "${active_services[@]-}"; do
    [ -n "$service" ] || continue
    recovery intent "$service" || failed=1
    /usr/bin/systemctl stop "$service" || failed=1
  done
  recovery recovery || failed=1
  return "$failed"
}

start_active() {
  local service failed=0
  for service in "${active_services[@]-}"; do
    [ -n "$service" ] || continue
    /usr/bin/systemctl start "$service" || failed=1
  done
  return "$failed"
}

# shellcheck disable=SC2329 # invoked indirectly by the EXIT trap
cleanup() {
  local status=$?
  trap - EXIT
  if [ "$authorized_exit" -ne 1 ]; then
    stop_active || true
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

active_text="$(recovery services)" || exit 1
while IFS= read -r service; do
  [ -n "$service" ] && active_services+=("$service")
done <<< "$active_text"
expected_services="$(printf '%s\n' "${services[@]}")"
if [[ "$active_text" != "$expected_services" ]]; then
  echo "quiesce lease: complete active-service snapshot is required" >&2
  exit 1
fi
for service in "${services[@]}"; do
  # The complete restore snapshot was fsynced before this helper started.
  # Record each stop intent before stopping units that might be active.
  recovery intent "$service"
  /usr/bin/systemctl stop "$service"
done

printf 'READY\n'
while IFS= read -r command; do
  case "$command" in
    START_HEALTH)
      start_active || { recovery recovery; printf 'ERROR\n'; continue; }
      printf 'STARTED\n'
      ;;
    ABORT)
      stop_active || { printf 'ERROR\n'; exit 1; }
      printf 'STOPPED\n'
      ;;
    HEALTHY)
      recovery clear || exit 1
      authorized_exit=1
      printf 'DONE\n'
      exit 0
      ;;
    RESTORE)
      start_active || { recovery recovery; printf 'ERROR\n'; exit 1; }
      recovery clear || exit 1
      authorized_exit=1
      printf 'DONE\n'
      exit 0
      ;;
    *)
      recovery recovery || true
      printf 'ERROR\n'
      exit 1
      ;;
  esac
done

# Parent death or a broken control pipe never means "restart services".
stop_active || true
recovery recovery || true
exit 1
