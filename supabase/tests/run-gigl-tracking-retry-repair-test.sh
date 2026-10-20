#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
container="baci-gigl-retry-repair-${RANDOM}-$$"
fixture_root="$(mktemp -d)"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$fixture_root"
}
trap cleanup EXIT

wait_for_postgres() {
  for _ in $(seq 1 30); do
    logs="$(docker logs "$container" 2>&1 || true)"
    if grep -Fq 'PostgreSQL init process complete; ready for start up.' <<<"$logs" &&
      docker exec "$container" psql -X -qAt -U postgres -h 127.0.0.1 \
        -c 'SELECT 1' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  docker logs "$container" >&2 || true
  return 1
}

mkdir -p "$fixture_root/bin" "$fixture_root/migrations"
docker run --name "$container" -e POSTGRES_PASSWORD=test -d postgres:17-alpine >/dev/null
wait_for_postgres

docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -h 127.0.0.1 \
  < "$repo_root/supabase/tests/gigl_tracking_retry_repair_fixture.sql"
cp \
  "$repo_root/supabase/migrations/20260801141800_harden_gigl_tracking_retry_edges.sql" \
  "$fixture_root/migrations/20260801141800_harden_gigl_tracking_retry_edges.sql"
cp \
  "$repo_root/supabase/migrations/20260803000700_repair_gigl_tracking_retry_edges.sql" \
  "$fixture_root/migrations/20260803000700_repair_gigl_tracking_retry_edges.sql"
cp \
  "$repo_root/supabase/migrations/20260801141900_scope_gigl_recovery_to_failed_event.sql" \
  "$fixture_root/migrations/20260801141900_scope_gigl_recovery_to_failed_event.sql"
cp \
  "$repo_root/supabase/migrations/20260804000100_repair_gigl_failed_event_recovery_scope.sql" \
  "$fixture_root/migrations/20260804000100_repair_gigl_failed_event_recovery_scope.sql"
cp \
  "$repo_root/supabase/migrations/20260801142000_harden_gigl_notification_recovery_edges.sql" \
  "$fixture_root/migrations/20260801142000_harden_gigl_notification_recovery_edges.sql"
cp \
  "$repo_root/supabase/migrations/20260804000200_repair_gigl_notification_recovery_edges.sql" \
  "$fixture_root/migrations/20260804000200_repair_gigl_notification_recovery_edges.sql"
cp \
  "$repo_root/supabase/migrations/20260804000400_repair_gigl_notification_terminality_cardinality.sql" \
  "$fixture_root/migrations/20260804000400_repair_gigl_notification_terminality_cardinality.sql"
cp \
  "$repo_root/supabase/migrations/20260801142100_preserve_manual_gigl_failures_after_unknown_scans.sql" \
  "$fixture_root/migrations/20260801142100_preserve_manual_gigl_failures_after_unknown_scans.sql"
cp \
  "$repo_root/supabase/migrations/20260804000300_repair_gigl_manual_failure_status_scope.sql" \
  "$fixture_root/migrations/20260804000300_repair_gigl_manual_failure_status_scope.sql"

cat > "$fixture_root/bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail

data_binary=''
while (($#)); do
  case "$1" in
    --data-binary)
      if (($# < 2)); then
        echo 'Expected a value for --data-binary' >&2
        exit 2
      fi
      data_binary="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
if [ "$data_binary" != '@-' ]; then
  echo "Expected curl --data-binary @-, got ${data_binary:-<missing>}" >&2
  exit 2
fi

payload="$(cat)"
query="$(jq -r '.query' <<<"$payload")"
if [[ "$query" == SELECT\ version,\ name,\ encode\(sha256\(* ]]; then
  rows="$(docker exec "$MIGRATION_TEST_CONTAINER" psql -X -qAt -F $'\t' -U postgres -h 127.0.0.1 -c "$query")"
  if [[ -n "$rows" ]]; then
    jq -Rn '[inputs | split("\t") | {version: .[0], name: .[1], statements_sha256: .[2]}]' <<<"$rows"
  else
    printf '[]\n'
  fi
else
  docker exec "$MIGRATION_TEST_CONTAINER" psql -X -q -v ON_ERROR_STOP=1 -U postgres -h 127.0.0.1 -c "$query" >/dev/null
  printf '[]\n'
fi
FAKE_CURL
chmod +x "$fixture_root/bin/curl"

PATH="$fixture_root/bin:$PATH" \
  MIGRATION_TEST_CONTAINER="$container" \
  MIGRATIONS_DIR="$fixture_root/migrations" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  bash "$repo_root/.github/scripts/apply-pending-migrations.sh"

docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -h 127.0.0.1 \
  < "$repo_root/supabase/tests/gigl_tracking_retry_repair.sql"

echo 'GIGL tracking retry repair PostgreSQL test passed'
