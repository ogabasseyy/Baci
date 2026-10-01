#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
applier="$script_dir/apply-pending-migrations.sh"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

fake_bin="$fixture_root/bin"
migrations="$fixture_root/migrations"
query_log="$fixture_root/queries.log"
mkdir -p "$fake_bin" "$migrations"

cat >"$fake_bin/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail
payload="$(cat)"
printf '%s\n' "$payload" >>"$FAKE_QUERY_LOG"
if jq -e '.query | startswith("SELECT version, name")' >/dev/null <<<"$payload"; then
  printf '%s\n' "$FAKE_INITIAL_RESPONSE"
else
  printf '%s\n' '[]'
fi
FAKE_CURL
chmod +x "$fake_bin/curl"

printf '%s\n' "SELECT 'colliding paystack source';" \
  >"$migrations/20260805090000_complete_merchant_invoice_partial_payments.sql"
printf '%s\n' "SELECT 'review contract repair';" \
  >"$migrations/20260805090001_reapply_merchant_invoice_partial_review_contract.sql"
printf '%s\n' "SELECT 'completion function repair';" \
  >"$migrations/20260805090002_reapply_complete_merchant_invoice_partial_payment.sql"

PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$migrations" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$query_log" \
  FAKE_INITIAL_RESPONSE='[{"version":"20260805090000","name":"add_least_privilege_gigl_tracking_worker"}]' \
  bash "$applier" >"$fixture_root/output.log"

grep -q \
  'Historical collision 20260805090000 is reconciled by repair migration 20260805090002_reapply_complete_merchant_invoice_partial_payment.sql' \
  "$fixture_root/output.log"
grep -q \
  'applied:         20260805090001  reapply_merchant_invoice_partial_review_contract' \
  "$fixture_root/output.log"
grep -q \
  'applied:         20260805090002  reapply_complete_merchant_invoice_partial_payment' \
  "$fixture_root/output.log"

if grep -q \
  "schema_migrations(version, name, statements).*20260805090000.*complete_merchant_invoice_partial_payments" \
  "$query_log"; then
  echo 'The occupied historical version must not be registered again' >&2
  exit 1
fi

first_repair_line="$(grep -n '20260805090001' "$query_log" | head -1 | cut -d: -f1)"
second_repair_line="$(grep -n '20260805090002' "$query_log" | head -1 | cut -d: -f1)"
if [ -z "$first_repair_line" ] || [ -z "$second_repair_line" ] || \
  [ "$first_repair_line" -ge "$second_repair_line" ]; then
  echo 'The split Paystack repair must be registered in dependency order' >&2
  exit 1
fi

uuid_migrations="$fixture_root/uuid-migrations"
uuid_query_log="$fixture_root/uuid-queries.log"
mkdir -p "$uuid_migrations"
cp "$script_dir/../../supabase/migrations/20260811135000_harden_paystack_chat_order_relationship.sql" \
  "$uuid_migrations/20260811135000_harden_paystack_chat_order_relationship.sql"
cp "$script_dir/../../supabase/migrations/20260813192730_repair_harden_paystack_chat_order_relationship.sql" \
  "$uuid_migrations/20260813192730_repair_harden_paystack_chat_order_relationship.sql"

PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$uuid_migrations" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$uuid_query_log" \
  FAKE_INITIAL_RESPONSE='[{"version":"20260811130000","name":"serialize_wallet_paystack_reference_claims"},{"version":"20260811135000","name":"harden_paystack_chat_order_relationship"}]' \
  bash "$applier" >"$fixture_root/uuid-output.log"

grep -q \
  'applied:         20260813192730  repair_harden_paystack_chat_order_relationship' \
  "$fixture_root/uuid-output.log"
grep -q 'array_agg(co.id ORDER BY co.id)' "$uuid_query_log"
if grep -q 'min(co.id)' "$uuid_query_log"; then
  echo 'The UUID repair must not submit the unsupported min(uuid) aggregate' >&2
  exit 1
fi

uuid_pending_migrations="$fixture_root/uuid-pending-migrations"
uuid_pending_query_log="$fixture_root/uuid-pending-queries.log"
mkdir -p "$uuid_pending_migrations"
cp "$script_dir/../../supabase/migrations/20260811135000_harden_paystack_chat_order_relationship.sql" \
  "$uuid_pending_migrations/20260811135000_harden_paystack_chat_order_relationship.sql"
cp "$script_dir/../../supabase/migrations/20260813192730_repair_harden_paystack_chat_order_relationship.sql" \
  "$uuid_pending_migrations/20260813192730_repair_harden_paystack_chat_order_relationship.sql"

PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$uuid_pending_migrations" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$uuid_pending_query_log" \
  FAKE_INITIAL_RESPONSE='[{"version":"20260811130000","name":"serialize_wallet_paystack_reference_claims"}]' \
  bash "$applier" >"$fixture_root/uuid-pending-output.log"

grep -q \
  'reconciled by append-only repair migration 20260813192730_repair_harden_paystack_chat_order_relationship.sql' \
  "$fixture_root/uuid-pending-output.log"
if grep -q '^→ applying:        20260811135000' "$fixture_root/uuid-pending-output.log" || \
  grep -q 'min(co.id)' "$uuid_pending_query_log" || \
  ! grep -q 'array_agg(co.id ORDER BY co.id)' "$uuid_pending_query_log"; then
  echo 'The pending UUID migration must be reconciled before its unsupported SQL is submitted' >&2
  exit 1
fi

: >"$query_log"
printf '%s\n' "SELECT 'colliding Paystack override source';" \
  >"$migrations/20260811120000_allow_reviewed_paystack_email_mismatch.sql"
printf '%s\n' "SELECT 'Paystack override collision repair';" \
  >"$migrations/20260813144355_reapply_allow_reviewed_paystack_email_mismatch.sql"

PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$migrations" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$query_log" \
  FAKE_INITIAL_RESPONSE='[{"version":"20260805090000","name":"add_least_privilege_gigl_tracking_worker"},{"version":"20260805090001","name":"reapply_merchant_invoice_partial_review_contract"},{"version":"20260805090002","name":"reapply_complete_merchant_invoice_partial_payment"},{"version":"20260811120000","name":"quiz_leaderboard_and_claim_projections_v2"}]' \
  bash "$applier" >"$fixture_root/paystack-output.log"

grep -q \
  'Historical collision 20260811120000 is reconciled by repair migration 20260813144355_reapply_allow_reviewed_paystack_email_mismatch.sql' \
  "$fixture_root/paystack-output.log"
grep -q \
  'applied:         20260813144355  reapply_allow_reviewed_paystack_email_mismatch' \
  "$fixture_root/paystack-output.log"

if grep -q \
  "schema_migrations(version, name, statements).*20260811120000.*allow_reviewed_paystack_email_mismatch" \
  "$query_log"; then
  echo 'The occupied Paystack migration version must not be registered again' >&2
  exit 1
fi

review_migrations="$fixture_root/paystack-review-migrations"
review_query_log="$fixture_root/paystack-review-queries.log"
mkdir -p "$review_migrations"
cp "$script_dir/../../supabase/migrations/20260811120000_allow_reviewed_paystack_email_mismatch.sql" \
  "$review_migrations/20260811120000_allow_reviewed_paystack_email_mismatch.sql"
cp "$script_dir/../../supabase/migrations/20260813144355_reapply_allow_reviewed_paystack_email_mismatch.sql" \
  "$review_migrations/20260813144355_reapply_allow_reviewed_paystack_email_mismatch.sql"
cp "$script_dir/../../supabase/migrations/20260811140000_harden_paystack_manual_reconciliation_review_contracts.sql" \
  "$review_migrations/20260811140000_harden_paystack_manual_reconciliation_review_contracts.sql"
cp "$script_dir/../../supabase/migrations/20260814153213_repair_harden_paystack_manual_reconciliation_review_contracts.sql" \
  "$review_migrations/20260814153213_repair_harden_paystack_manual_reconciliation_review_contracts.sql"

PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$review_migrations" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$review_query_log" \
  FAKE_INITIAL_RESPONSE='[{"version":"20260811120000","name":"quiz_leaderboard_and_claim_projections_v2"}]' \
  bash "$applier" >"$fixture_root/paystack-review-output.log"

grep -q \
  'reconciled by append-only repair migration 20260814153213_repair_harden_paystack_manual_reconciliation_review_contracts.sql' \
  "$fixture_root/paystack-review-output.log"
grep -q \
  'p_allow_email_mismatch boolean' \
  "$review_query_log"
if grep -q '^→ applying:        20260811140000' "$fixture_root/paystack-review-output.log"; then
  echo 'The Paystack review contract migration must be reconciled before its missing dependency is applied' >&2
  exit 1
fi

quiz_migrations="$fixture_root/quiz-materialized-migrations"
quiz_query_log="$fixture_root/quiz-materialized-queries.log"
mkdir -p "$quiz_migrations"
cp "$script_dir/../../supabase/migrations/20260812170000_quiz_materialized_final_rankings_v2.sql" \
  "$quiz_migrations/20260812170000_quiz_materialized_final_rankings_v2.sql"
cp "$script_dir/../../supabase/migrations/20260814230000_repair_quiz_materialized_final_rankings_v2.sql" \
  "$quiz_migrations/20260814230000_repair_quiz_materialized_final_rankings_v2.sql"

PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$quiz_migrations" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$quiz_query_log" \
  FAKE_INITIAL_RESPONSE='[]' \
  bash "$applier" >"$fixture_root/quiz-materialized-output.log"

grep -q \
  'reconciled by append-only repair migration 20260814230000_repair_quiz_materialized_final_rankings_v2.sql' \
  "$fixture_root/quiz-materialized-output.log"
grep -q 'total_time_milliseconds' "$quiz_query_log"
if grep -q '^→ applying:        20260812170000' "$fixture_root/quiz-materialized-output.log"; then
  echo 'The quiz materialization migration must be reconciled before its incompatible backfill runs' >&2
  exit 1
fi

quiz_policy_migrations="$fixture_root/quiz-policy-migrations"
quiz_policy_query_log="$fixture_root/quiz-policy-queries.log"
mkdir -p "$quiz_policy_migrations"
cp "$script_dir/../../supabase/migrations/20260812173500_quiz_event_results_v2_deny_client_policy.sql" \
  "$quiz_policy_migrations/20260812173500_quiz_event_results_v2_deny_client_policy.sql"
cp "$script_dir/../../supabase/migrations/20260815000000_repair_quiz_event_results_v2_deny_client_policy.sql" \
  "$quiz_policy_migrations/20260815000000_repair_quiz_event_results_v2_deny_client_policy.sql"

PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$quiz_policy_migrations" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$quiz_policy_query_log" \
  FAKE_INITIAL_RESPONSE='[]' \
  bash "$applier" >"$fixture_root/quiz-policy-output.log"

grep -q \
  'reconciled by append-only repair migration 20260815000000_repair_quiz_event_results_v2_deny_client_policy.sql' \
  "$fixture_root/quiz-policy-output.log"
grep -q \
  "schema_migrations(version, name, statements).*20260815000000.*repair_quiz_event_results_v2_deny_client_policy" \
  "$quiz_policy_query_log"
grep -q 'pg_catalog.pg_policies' "$quiz_policy_query_log"
if grep -q '^→ applying:        20260812173500' "$fixture_root/quiz-policy-output.log"; then
  echo 'The existing quiz deny policy must be reconciled before its duplicate CREATE POLICY runs' >&2
  exit 1
fi
