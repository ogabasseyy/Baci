#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

make_applier_fixture() {
  local directory="$1"
  mkdir -p "$directory/migrations"
  cp "$script_dir/apply-pending-migrations.sh" "$directory/"
  cp "$script_dir/apply-pending-migration.sh" "$directory/"
  cp "$script_dir/repair-sales-migration-collision.sh" "$directory/"
  cp "$script_dir/apply-atomic-migration-group.sh" "$directory/"
  cp "$script_dir/deferred-production-migrations.sh" "$directory/"
  cp "$script_dir/historical-migration-repair-handler.sh" "$directory/"
  cp "$script_dir/check-migration-versions.sh" "$directory/"
  printf 'SELECT 1;\n' >"$directory/migrations/20260101000000_probe.sql"
}

missing_spec_dir="$fixture_root/missing-spec"
make_applier_fixture "$missing_spec_dir"
if MIGRATIONS_DIR="$missing_spec_dir/migrations" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  bash "$missing_spec_dir/apply-pending-migrations.sh" \
  >"$fixture_root/missing-spec-output.log" 2>&1; then
  echo 'Expected a missing historical repair specification to fail closed' >&2
  exit 1
fi
grep -q 'historical repair specification not found' \
  "$fixture_root/missing-spec-output.log"

missing_function_dir="$fixture_root/missing-function"
make_applier_fixture "$missing_function_dir"
printf ':\n' >"$missing_function_dir/historical-migration-repair-spec.sh"
if MIGRATIONS_DIR="$missing_function_dir/migrations" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  bash "$missing_function_dir/apply-pending-migrations.sh" \
  >"$fixture_root/missing-function-output.log" 2>&1; then
  echo 'Expected a repair specification without its resolver to fail closed' >&2
  exit 1
fi
grep -q 'historical_migration_repair_spec not defined' \
  "$fixture_root/missing-function-output.log"

missing_supersession_dir="$fixture_root/missing-supersession"
make_applier_fixture "$missing_supersession_dir"
printf 'historical_migration_repair_spec() { return 1; }\n' \
  >"$missing_supersession_dir/historical-migration-repair-spec.sh"
if MIGRATIONS_DIR="$missing_supersession_dir/migrations" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  bash "$missing_supersession_dir/apply-pending-migrations.sh" \
  >"$fixture_root/missing-supersession-output.log" 2>&1; then
  echo 'Expected a missing supersession resolver to fail closed' >&2
  exit 1
fi
grep -q 'historical_migration_repair_supersession_spec not defined' \
  "$fixture_root/missing-supersession-output.log"

. "$script_dir/historical-migration-repair-spec.sh"
. "$script_dir/historical-migration-repair-handler.sh"

expected_repair=$'20260804000400\trepair_gigl_notification_terminality_cardinality\tb373ae3f70d7311004e7e4400c2b3a3c8534300e82ee01c2c9e0d3df2680b81e'
[ "$(historical_migration_repair_spec 20260801142000 harden_gigl_notification_recovery_edges)" = "$expected_repair" ]
expected_monitor_repair=$'20260804000500\trepair_gigl_monitor_backfill_join\t605a0d48a4f116e67ee626ff173b66c6c80cefa77ad606a3813aa1ea6deda62a'
[ "$(historical_migration_repair_spec 20260801142200 cleanup_unowned_gigl_monitor_backfill)" = "$expected_monitor_repair" ]
expected_paystack_repair=$'20260813192730\trepair_harden_paystack_chat_order_relationship\t210c24070e7295dcdec19e10d33dd456a1dbc24891812cc74b4bfddeff808456'
[ "$(historical_migration_repair_spec 20260811135000 harden_paystack_chat_order_relationship)" = "$expected_paystack_repair" ]
expected_paystack_review_repair=$'20260814153213\trepair_harden_paystack_manual_reconciliation_review_contracts\t4ed01fb7657a37530a4bdb5de152b4bf869e4b2ddaf7bc04c29f7ca131207408'
[ "$(historical_migration_repair_spec 20260811140000 harden_paystack_manual_reconciliation_review_contracts)" = "$expected_paystack_review_repair" ]
expected_quiz_repair=$'20260814230000\trepair_quiz_materialized_final_rankings_v2\t1b3eec0aa6d442ab9f3a61149e0839a0cad6aab80ea567200c815b9e2c98dee5'
[ "$(historical_migration_repair_spec 20260812170000 quiz_materialized_final_rankings_v2)" = "$expected_quiz_repair" ]
expected_quiz_policy_repair=$'20260815000000\trepair_quiz_event_results_v2_deny_client_policy\t2a1d2341ec3631c74b9d44043db1f67f80b51012a796aea6477231bedfab98ef'
[ "$(historical_migration_repair_spec 20260812173500 quiz_event_results_v2_deny_client_policy)" = "$expected_quiz_policy_repair" ]
expected_private_receipt_repair=$'20260815220000\trepair_capture_private_expense_receipt_cleanup\t64530e9b7d94d9e2f832a8464593af977cb0af18c727a1a1b54c62310550997b'
[ "$(historical_migration_repair_spec 20260815103000 capture_private_expense_receipt_cleanup)" = "$expected_private_receipt_repair" ]
supersession="$(historical_migration_repair_supersession_spec 20260804000200 repair_gigl_notification_recovery_edges)"
applied_migrations=$'20260801142000\tharden_gigl_notification_recovery_edges\n20260804000400\trepair_gigl_notification_terminality_cardinality'
skipped_count=0
skip_superseded_historical_migration_repair 20260804000200 repair_gigl_notification_recovery_edges "$supersession" >"$fixture_root/supersession-output.log"
grep -q 'Superseded append-only repair 20260804000200 is skipped' "$fixture_root/supersession-output.log"
[ "$skipped_count" -eq 1 ]
applied_migrations=$'20260801142000\tharden_gigl_notification_recovery_edges'
migrations_dir="$fixture_root/incomplete-supersession-migrations"
mkdir -p "$migrations_dir"
if skip_superseded_historical_migration_repair 20260804000200 repair_gigl_notification_recovery_edges "$supersession" >"$fixture_root/incomplete-supersession-output.log" 2>&1; then
  echo 'Expected an incomplete supersession to fail closed' >&2
  exit 1
fi
grep -q 'requires replacement 20260804000400_repair_gigl_notification_terminality_cardinality.sql' \
  "$fixture_root/incomplete-supersession-output.log"

bash "$script_dir/historical-migration-repair-supersession.test.sh"

echo 'Historical migration repair specification loader tests passed'
