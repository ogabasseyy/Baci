#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT
mkdir -p "$fixture_root/bin" "$fixture_root/migrations"
export FAKE_QUERY_LOG="$fixture_root/queries.log"
export MIGRATIONS_DIR="$fixture_root/migrations"
export SUPABASE_ACCESS_TOKEN=test SUPABASE_PROJECT_REF=test
export PATH="$fixture_root/bin:$PATH"
cat >"$fixture_root/bin/curl" <<'CURL'
#!/usr/bin/env bash
payload="$(cat)"
printf '%s\n' "$payload" >>"$FAKE_QUERY_LOG"
if jq -e '.query | startswith("SELECT version, name")' >/dev/null <<<"$payload"; then
  printf '%s\n' "$FAKE_INITIAL_RESPONSE"
else
  printf '%s\n' '[]'
fi
CURL
chmod +x "$fixture_root/bin/curl"
converge=20260805091000_converge_gigl_tracking_worker_nologin
restore=20260805113000_restore_gigl_tracking_postgrest_capability
isolate=20260805170000_isolate_gigl_tracking_postgrest_capability
for migration in "$converge" "$restore" "$isolate"; do
  cp "$script_dir/../../supabase/migrations/$migration.sql" "$MIGRATIONS_DIR/"
done
export FAKE_INITIAL_RESPONSE='[{"version":"20260805091000","name":"enable_least_privilege_gigl_tracking_login"}]'
export MIGRATION_MAX_VERSION=20260805113000
bash "$script_dir/apply-pending-migrations.sh" >"$fixture_root/output"
grep -q "reconciled by repair migration $restore.sql" "$fixture_root/output"
grep -q 'ALTER ROLE gigl_tracking_worker NOLOGIN' "$FAKE_QUERY_LOG"
grep -q 'enforce_gigl_tracking_worker_request_scope' "$FAKE_QUERY_LOG"
if grep -q 'GRANT gigl_tracking_worker TO authenticator' "$FAKE_QUERY_LOG" || \
   grep -q 'INSERT INTO supabase_migrations.schema_migrations.*20260805091000' "$FAKE_QUERY_LOG"; then
  echo 'Must preserve historical record and defer membership until the hook probe' >&2
  exit 1
fi

expect_refusal() {
  : >"$FAKE_QUERY_LOG"
  if bash "$script_dir/apply-pending-migrations.sh" >"$fixture_root/refusal" 2>&1; then
    echo 'Expected invalid history or missing repair to fail closed' >&2
    exit 1
  fi
  [ "$(jq -s length "$FAKE_QUERY_LOG")" = 1 ]
}
export FAKE_INITIAL_RESPONSE='[{"version":"20260805091000","name":"unexpected"}]'
expect_refusal
export FAKE_INITIAL_RESPONSE='[{"version":"20260805091000","name":"enable_least_privilege_gigl_tracking_login"},{"version":"20260805113000","name":"unexpected"}]'
expect_refusal
export FAKE_INITIAL_RESPONSE='[{"version":"20260805091000","name":"enable_least_privilege_gigl_tracking_login"}]'
mv "$MIGRATIONS_DIR/$restore.sql" "$fixture_root/restore.sql"
expect_refusal

# Once the actual repair is recorded, a retry must not replay either old role
# transition or require the historical repair file to remain in a sparse tree.
export FAKE_INITIAL_RESPONSE='[{"version":"20260805091000","name":"enable_least_privilege_gigl_tracking_login"},{"version":"20260805113000","name":"restore_gigl_tracking_postgrest_capability"}]'
: >"$FAKE_QUERY_LOG"
bash "$script_dir/apply-pending-migrations.sh" >"$fixture_root/retry"
[ "$(jq -s length "$FAKE_QUERY_LOG")" = 1 ]
printf '%s\n' 'GIGL migration history reconciliation tests passed'
