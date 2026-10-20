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
if [ -n "${FAKE_QUERY_LOG:-}" ]; then
  printf '%s\n' "$payload" >>"$FAKE_QUERY_LOG"
fi
if [[ "$query" == "SELECT version, name,"* ]]; then
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

alias_migrations="$fixture_root/version-alias-migrations"
mkdir -p "$alias_migrations"
for migration in \
  20261003180000_storefront_available_search_facets.sql \
  20261003193000_storefront_processor_filters.sql \
  20261003194500_storefront_category_facets.sql; do
  migration_file="$repo_root/supabase/migrations/$migration"
  cp "$migration_file" "$alias_migrations/$migration"
  version="${migration%%_*}"
  name="${migration#*_}"
  name="${name%.sql}"
  case "$version" in
    20261003180000) recorded_version='20261003175517' ;;
    20261003193000) recorded_version='20261003183737' ;;
    20261003194500) recorded_version='20261003184149' ;;
    *) echo "Unexpected alias migration in PostgreSQL fixture: $migration" >&2; exit 1 ;;
  esac
  recorded_sql_file="$migration_file"
  if [ "$version" = '20261003194500' ]; then
    recorded_sql_file="$repo_root/supabase/tests/fixtures/storefront-category-facets-recorded.sql"
  fi
  statement_b64="$(base64 <"$recorded_sql_file" | tr -d '\n')"
  docker exec -i "$container" psql -X -q -v ON_ERROR_STOP=1 \
    -v "version=$recorded_version" \
    -v "name=$name" \
    -v "statement_b64=$statement_b64" \
    -U postgres -h 127.0.0.1 <<'SQL'
INSERT INTO supabase_migrations.schema_migrations(version, name, statements)
VALUES (:'version', :'name', ARRAY[convert_from(decode(:'statement_b64', 'base64'), 'UTF8')]);
SQL
done

alias_log="$fixture_root/version-alias-queries.log"
alias_output="$fixture_root/version-alias-output.log"
PATH="$fixture_root/bin:$PATH" \
  MIGRATION_TEST_CONTAINER="$container" \
  MIGRATIONS_DIR="$alias_migrations" \
  FAKE_QUERY_LOG="$alias_log" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  bash "$repo_root/.github/scripts/apply-pending-migrations.sh" >"$alias_output"
grep -q 'already applied under version 20261003175517: 20261003180000  storefront_available_search_facets' "$alias_output"
grep -q 'already applied under version 20261003183737: 20261003193000  storefront_processor_filters' "$alias_output"
grep -q 'already applied under version 20261003184149: 20261003194500  storefront_category_facets' "$alias_output"
grep -q 'Migrations summary: 0 applied, 3 skipped.' "$alias_output"
if grep -q 'INSERT INTO supabase_migrations.schema_migrations' "$alias_log"; then
  echo 'PostgreSQL-backed historical aliases must not write duplicate migration rows' >&2
  exit 1
fi

echo 'GIGL tracking retry repair PostgreSQL test passed'
echo 'Historical migration version alias PostgreSQL test passed'
