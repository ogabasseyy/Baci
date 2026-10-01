#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container="baci-gigl-monitor-backfill-${RANDOM}-$$"
fixture_root="$(mktemp -d)"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$fixture_root"
}

wait_for_postgres_final_readiness() {
  local target_container="$1"
  local max_attempts="${2:-30}"
  local logs
  for _ in $(seq 1 "$max_attempts"); do
    logs="$(docker logs "$target_container" 2>&1 || true)"
    if grep -Fq 'PostgreSQL init process complete; ready for start up.' <<<"$logs" &&
      docker exec "$target_container" psql -X -qAt -U postgres -h 127.0.0.1 \
        -c 'SELECT 1' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  docker logs "$target_container" >&2 || true
  return 1
}

main() {
  trap cleanup EXIT
  docker run --name "$container" -e POSTGRES_PASSWORD=test -d postgres:17-alpine >/dev/null
  if ! wait_for_postgres_final_readiness "$container"; then
    echo 'PostgreSQL did not reach final readiness' >&2
    exit 1
  fi

  docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -h 127.0.0.1 \
    < "$repo_root/supabase/tests/gigl_monitor_backfill_repair_fixture.sql"
  docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -h 127.0.0.1 \
    < "$repo_root/supabase/migrations/20260804000500_repair_gigl_monitor_backfill_join.sql"
  docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -h 127.0.0.1 \
    < "$repo_root/supabase/tests/gigl_monitor_backfill_repair.sql"

  echo 'GIGL monitor backfill repair PostgreSQL test passed'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
