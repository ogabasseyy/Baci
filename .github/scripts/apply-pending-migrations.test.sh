#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
applier="$script_dir/apply-pending-migrations.sh"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

fake_bin="$fixture_root/bin"
mkdir -p "$fake_bin"

cat >"$fake_bin/curl" <<'FAKE_CURL'
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
printf '%s\n' "$payload" >>"$FAKE_QUERY_LOG"
if jq -e '.query | startswith("SELECT version, name")' >/dev/null <<<"$payload"; then
  printf '%s\n' "$FAKE_INITIAL_RESPONSE"
else
  if [ "${FAKE_FAIL_NON_SELECT:-0}" = '1' ]; then
    printf '%s\n' "$FAKE_ERROR_RESPONSE"
    exit 22
  fi
  printf '%s\n' '[]'
fi
FAKE_CURL
chmod +x "$fake_bin/curl"

make_collision_fixture() {
  local directory="$1"
  mkdir -p "$directory"
  printf '%s\n' "SELECT 'paystack';" >"$directory/20260713130000_add_storefront_paystack_subaccount_configured_rpc.sql"
  printf '%s\n' "SELECT 'quiz';" >"$directory/20260713130000_quiz_finalize_rank_winners.sql"
  printf '%s\n' "SELECT 'repair';" >"$directory/20260713140000_quiz_finalize_rank_winners_reapply.sql"
}

fresh_dir="$fixture_root/fresh"
make_collision_fixture "$fresh_dir"
fresh_log="$fixture_root/fresh-queries.log"
fresh_output="$fixture_root/fresh-output.log"
PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$fresh_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$fresh_log" \
  FAKE_INITIAL_RESPONSE='[]' \
  bash "$applier" >"$fresh_output"

grep -q 'applied:         20260713130000  add_storefront_paystack_subaccount_configured_rpc' "$fresh_output"
grep -q 'already applied: 20260713130000  quiz_finalize_rank_winners' "$fresh_output"
grep -q 'reconciled by repair migration 20260713140000' "$fresh_output"
grep -q 'applied:         20260713140000  quiz_finalize_rank_winners_reapply' "$fresh_output"
if [ "$(grep -c "schema_migrations(version, name, statements).*20260713130000" "$fresh_log")" -ne 1 ]; then
  echo 'Expected the historical collision version to be registered exactly once' >&2
  exit 1
fi

historical_repair_dir="$fixture_root/historical-repair"
mkdir -p "$historical_repair_dir"
cp \
  "$script_dir/../../supabase/migrations/20260727220050_shipment_tracking_realtime_broadcast.sql" \
  "$historical_repair_dir/20260727220050_shipment_tracking_realtime_broadcast.sql"
cp \
  "$script_dir/../../supabase/migrations/20260803000600_repair_gigl_tracking_realtime_broadcast.sql" \
  "$historical_repair_dir/20260803000600_repair_gigl_tracking_realtime_broadcast.sql"
historical_repair_log="$fixture_root/historical-repair-queries.log"
historical_repair_output="$fixture_root/historical-repair-output.log"
PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$historical_repair_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$historical_repair_log" \
  FAKE_INITIAL_RESPONSE='[]' \
  bash "$applier" >"$historical_repair_output"
grep -q \
  'reconciled by append-only repair migration 20260803000600_repair_gigl_tracking_realtime_broadcast.sql' \
  "$historical_repair_output"
grep -q \
  'applied:         20260803000600  repair_gigl_tracking_realtime_broadcast' \
  "$historical_repair_output"
grep -q 'Migrations summary: 1 applied, 1 skipped.' "$historical_repair_output"
if grep -q 'pg_catalog.substring(realtime.topic() FROM 16)' "$historical_repair_log"; then
  echo 'Historical failed migration SQL must not be sent to Supabase' >&2
  exit 1
fi
if [ "$(grep -c "schema_migrations(version, name, statements).*20260727220050" "$historical_repair_log")" -ne 1 ]; then
  echo 'Expected the historical failed migration to be reconciled exactly once' >&2
  exit 1
fi
grep -q 'pg_catalog.substr(realtime.topic(), 16)' "$historical_repair_log"

retry_repair_dir="$fixture_root/retry-repair"
mkdir -p "$retry_repair_dir"
cp \
  "$script_dir/../../supabase/migrations/20260801141800_harden_gigl_tracking_retry_edges.sql" \
  "$retry_repair_dir/20260801141800_harden_gigl_tracking_retry_edges.sql"
cp \
  "$script_dir/../../supabase/migrations/20260803000700_repair_gigl_tracking_retry_edges.sql" \
  "$retry_repair_dir/20260803000700_repair_gigl_tracking_retry_edges.sql"
retry_repair_log="$fixture_root/retry-repair-queries.log"
retry_repair_output="$fixture_root/retry-repair-output.log"
PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$retry_repair_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$retry_repair_log" \
  FAKE_INITIAL_RESPONSE='[]' \
  bash "$applier" >"$retry_repair_output"
grep -q \
  'reconciled by append-only repair migration 20260803000700_repair_gigl_tracking_retry_edges.sql' \
  "$retry_repair_output"
grep -q \
  'applied:         20260803000700  repair_gigl_tracking_retry_edges' \
  "$retry_repair_output"
grep -q \
  "v_current_status = ''failed''" \
  "$retry_repair_log"
if grep -q \
  "tracking_timeline_generation\\\\n'\\\\n      '" \
  "$retry_repair_log"; then
  echo 'The malformed GIGL retry migration SQL must not be sent to Supabase' >&2
  exit 1
fi

invalid_dir="$fixture_root/invalid"
make_collision_fixture "$invalid_dir"
invalid_log="$fixture_root/invalid-queries.log"
if PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$invalid_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$invalid_log" \
  FAKE_INITIAL_RESPONSE='[{"version":"20260713130000","name":"unexpected"}]' \
  bash "$applier" >"$fixture_root/invalid-output.log" 2>&1; then
  echo 'Expected an unexpected recorded collision name to fail closed' >&2
  exit 1
fi
grep -q 'unexpected recorded/current name pair' "$fixture_root/invalid-output.log"

historical_alias_dir="$fixture_root/historical-alias"
mkdir -p "$historical_alias_dir"
printf '%s\n' "SELECT 'current';" \
  >"$historical_alias_dir/20260604132853_fix_create_storefront_order_customer_returning_id_ambiguity.sql"
historical_alias_log="$fixture_root/historical-alias-queries.log"
historical_alias_output="$fixture_root/historical-alias-output.log"
PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$historical_alias_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$historical_alias_log" \
  FAKE_INITIAL_RESPONSE='[{"version":"20260604132853","name":"fix_storefront_order_customer_returning_id_ambiguity"}]' \
  bash "$applier" >"$historical_alias_output"

grep -q \
  "historical name alias 20260604132853 is reconciled: fix_storefront_order_customer_returning_id_ambiguity -> fix_create_storefront_order_customer_returning_id_ambiguity" \
  "$historical_alias_output"
grep -q \
  'already applied: 20260604132853  fix_create_storefront_order_customer_returning_id_ambiguity' \
  "$historical_alias_output"
if grep -q 'INSERT INTO supabase_migrations.schema_migrations' "$historical_alias_log"; then
  echo 'Expected an approved historical name alias to remain already applied' >&2
  exit 1
fi

wrong_historical_alias_log="$fixture_root/wrong-historical-alias-queries.log"
if PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$historical_alias_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$wrong_historical_alias_log" \
  FAKE_INITIAL_RESPONSE='[{"version":"20260604132853","name":"unexpected"}]' \
  bash "$applier" >"$fixture_root/wrong-historical-alias-output.log" 2>&1; then
  echo 'Expected an unexpected name for the historical alias version to fail closed' >&2
  exit 1
fi
grep -q \
  "recorded as 'unexpected', not current file 'fix_create_storefront_order_customer_returning_id_ambiguity'" \
  "$fixture_root/wrong-historical-alias-output.log"
if grep -q 'INSERT INTO supabase_migrations.schema_migrations' "$wrong_historical_alias_log"; then
  echo 'Rejected historical aliases must not write migration state' >&2
  exit 1
fi

renamed_dir="$fixture_root/renamed"
mkdir -p "$renamed_dir"
printf '%s\n' "SELECT 'current';" >"$renamed_dir/20260101000000_current.sql"
renamed_log="$fixture_root/renamed-queries.log"
if PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$renamed_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$renamed_log" \
  FAKE_INITIAL_RESPONSE='[{"version":"20260101000000","name":"recorded"}]' \
  bash "$applier" >"$fixture_root/renamed-output.log" 2>&1; then
  echo 'Expected a non-collision version/name mismatch to fail closed' >&2
  exit 1
fi
grep -q "recorded as 'recorded', not current file 'current'" "$fixture_root/renamed-output.log"

wrong_local_dir="$fixture_root/wrong-local-repair"
make_collision_fixture "$wrong_local_dir"
mv \
  "$wrong_local_dir/20260713140000_quiz_finalize_rank_winners_reapply.sql" \
  "$wrong_local_dir/20260713140000_unrelated.sql"
wrong_local_log="$fixture_root/wrong-local-repair-queries.log"
if PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$wrong_local_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$wrong_local_log" \
  FAKE_INITIAL_RESPONSE='[{"version":"20260713130000","name":"add_storefront_paystack_subaccount_configured_rpc"}]' \
  bash "$applier" >"$fixture_root/wrong-local-repair-output.log" 2>&1; then
  echo 'Expected an incorrectly named local repair migration to fail closed' >&2
  exit 1
fi
grep -q 'requires repair migration 20260713140000_quiz_finalize_rank_winners_reapply.sql' \
  "$fixture_root/wrong-local-repair-output.log"

wrong_remote_dir="$fixture_root/wrong-remote-repair"
make_collision_fixture "$wrong_remote_dir"
wrong_remote_log="$fixture_root/wrong-remote-repair-queries.log"
if PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$wrong_remote_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$wrong_remote_log" \
  FAKE_INITIAL_RESPONSE='[{"version":"20260713130000","name":"add_storefront_paystack_subaccount_configured_rpc"},{"version":"20260713140000","name":"unrelated"}]' \
  bash "$applier" >"$fixture_root/wrong-remote-repair-output.log" 2>&1; then
  echo 'Expected an incorrectly named remote repair migration to fail closed' >&2
  exit 1
fi
grep -q "Repair migration 20260713140000 is recorded as 'unrelated'" \
  "$fixture_root/wrong-remote-repair-output.log"

error_dir="$fixture_root/http-error"
mkdir -p "$error_dir"
printf '%s\n' "CREATE TABLE migration_error_probe (id integer);" \
  >"$error_dir/20260101000000_error.sql"
error_log="$fixture_root/http-error-queries.log"
if PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$error_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$error_log" \
  FAKE_INITIAL_RESPONSE='[]' \
  FAKE_FAIL_NON_SELECT=1 \
  FAKE_ERROR_RESPONSE='{"message":"migration failed"}' \
  bash "$applier" >"$fixture_root/http-error-output.log" 2>&1; then
  echo 'Expected an HTTP migration error to fail' >&2
  exit 1
fi
grep -q 'Response: {"message":"migration failed"}' "$fixture_root/http-error-output.log"
if jq -e \
  'select(.query | startswith("INSERT INTO supabase_migrations.schema_migrations"))' \
  "$error_log" >/dev/null; then
  echo 'Failed migrations must not write migration history' >&2
  exit 1
fi

unrepaired_sibling_dir="$fixture_root/unrepaired-sibling"
make_collision_fixture "$unrepaired_sibling_dir"
unrepaired_sibling_log="$fixture_root/unrepaired-sibling-queries.log"
if PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$unrepaired_sibling_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$unrepaired_sibling_log" \
  FAKE_INITIAL_RESPONSE='[{"version":"20260713130000","name":"quiz_finalize_rank_winners"},{"version":"20260713140000","name":"quiz_finalize_rank_winners_reapply"}]' \
  bash "$applier" >"$fixture_root/unrepaired-sibling-output.log" 2>&1; then
  echo 'Expected a recorded collision sibling without a complementary repair to fail closed' >&2
  exit 1
fi
grep -q "recorded 'quiz_finalize_rank_winners', whose missing sibling has no repair migration" \
  "$fixture_root/unrepaired-sibling-output.log"

echo 'Migration applier collision tests passed'
