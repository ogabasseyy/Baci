#!/usr/bin/env bash
# Fixed service supervisor. EOF is always an abort; only HEALTHY or RESTORE
# after the broker's durable state write may leave a release running.
set -euo pipefail

readonly python=/usr/bin/python3
readonly recovery_module=worker_release_recovery_latch
readonly services=(baci-domain-event-router baci-event-delivery-worker baci-quiz-finalization)
declare -a active_services=()
authorized_exit=0

recovery() {
  PYTHONPATH=/usr/local/lib/baci-worker-broker "$python" -m "$recovery_module" "$@"
}

stop_active() {
  local service failed=0
  for service in "${active_services[@]}"; do
    recovery intent "$service" || failed=1
    /usr/bin/systemctl stop "$service" || failed=1
  done
  recovery recovery || failed=1
  return "$failed"
}

start_active() {
  local service failed=0
  for service in "${active_services[@]}"; do
    /usr/bin/systemctl start "$service" || failed=1
  done
  return "$failed"
}

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
if [ -n "$active_text" ]; then
  mapfile -t active_services <<< "$active_text"
fi
for service in "${services[@]}"; do
  if /usr/bin/systemctl is-active --quiet "$service"; then
    recovery intent "$service"
    /usr/bin/systemctl stop "$service"
  else
    status=$?
    if [ "$status" -ne 3 ]; then
      echo "quiesce lease: systemd query failed for $service" >&2
      exit 1
    fi
  fi
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
