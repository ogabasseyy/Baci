#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
applier="$script_dir/apply-pending-migrations.sh"
pending_checker="$script_dir/pending-postdeploy-migrations.sh"
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
  printf '%s\n' '[]'
fi
FAKE_CURL
chmod +x "$fake_bin/curl"

deferred_dir="$fixture_root/deferred"
mkdir -p "$deferred_dir"
printf '%s\n' "SELECT 'delivery-metadata';" \
  >"$deferred_dir/20260827140000_enforce_storefront_order_delivery_metadata.sql"
printf '%s\n' "SELECT 'context';" \
  >"$deferred_dir/20260828091000_harden_storefront_order_rpc_context_and_replays.sql"
printf '%s\n' "SELECT 'quiz-context';" \
  >"$deferred_dir/20260828101000_allow_legacy_quiz_award_order_context.sql"
printf '%s\n' "SELECT 'hash-stamping';" \
  >"$deferred_dir/20260828110000_prepare_storefront_order_hash_stamping.sql"
printf '%s\n' "SELECT 'hash-stamping-finalizer';" \
  >"$deferred_dir/20260828110100_finalize_storefront_order_hash_stamping.sql"
printf '%s\n' "SELECT 'replay-context';" \
  >"$deferred_dir/20260828120000_enforce_storefront_order_replay_route_context.sql"
printf '%s\n' "SELECT 'replay-scope';" \
  >"$deferred_dir/20260828130000_scope_storefront_order_replay_route_context.sql"
printf '%s\n' "SELECT 'ordinary';" \
  >"$deferred_dir/20260828140000_ordinary_follow_up.sql"
printf '%s\n' "SELECT 'delivery-columns';" \
  >"$deferred_dir/20260828150000_prepare_storefront_order_delivery_columns.sql"
printf '%s\n' "SELECT 'pickup-location';" \
  >"$deferred_dir/20260828151000_enforce_storefront_airport_pickup_location.sql"
printf '%s\n' "SELECT 'delivery-metadata-persistence';" \
  >"$deferred_dir/20260828151100_prepare_storefront_order_delivery_metadata_persistence.sql"
printf '%s\n' "SELECT 'quiz-reserved-delivery-metadata';" \
  >"$deferred_dir/20260828160000_persist_quiz_reserved_order_delivery_metadata.sql"
printf '%s\n' "SELECT 'quiz-reserved-delivery-metadata-preserve';" \
  >"$deferred_dir/20260828160100_preserve_quiz_reserved_order_delivery_metadata.sql"
printf '%s\n' "SELECT 'quiz-reserved-delivery-validation-scope';" \
  >"$deferred_dir/20260828160200_limit_quiz_reserved_order_delivery_validation_to_redemption.sql"
printf '%s\n' "SELECT 'hash-version-context';" \
  >"$deferred_dir/20260828170000_prepare_storefront_order_hash_version_context.sql"
printf '%s\n' "SELECT 'delivery-metadata-enforcement-restore';" \
  >"$deferred_dir/20260828190000_restore_storefront_order_delivery_metadata_enforcement.sql"

pending_output="$fixture_root/pending-output.log"
PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$deferred_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$fixture_root/pending-queries.log" \
  FAKE_INITIAL_RESPONSE='[]' \
  bash "$pending_checker" >"$pending_output"
grep -qx 'true' "$pending_output"

all_deferred_response="$(jq -nc '[
  {version: "20260827140000", name: "enforce_storefront_order_delivery_metadata"},
  {version: "20260828091000", name: "harden_storefront_order_rpc_context_and_replays"},
  {version: "20260828101000", name: "allow_legacy_quiz_award_order_context"},
  {version: "20260828110000", name: "prepare_storefront_order_hash_stamping"},
  {version: "20260828110100", name: "finalize_storefront_order_hash_stamping"},
  {version: "20260828120000", name: "enforce_storefront_order_replay_route_context"},
  {version: "20260828130000", name: "scope_storefront_order_replay_route_context"},
  {version: "20260828151000", name: "enforce_storefront_airport_pickup_location"},
  {version: "20260828190000", name: "restore_storefront_order_delivery_metadata_enforcement"}
]')"
PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$deferred_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$fixture_root/complete-queries.log" \
  FAKE_INITIAL_RESPONSE="$all_deferred_response" \
  bash "$pending_checker" >"$fixture_root/complete-output.log"
grep -qx 'false' "$fixture_root/complete-output.log"

if PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$deferred_dir" \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$fixture_root/invalid-preflight-queries.log" \
  FAKE_INITIAL_RESPONSE='{"error":"broken"}' \
  bash "$pending_checker" >"$fixture_root/invalid-preflight-output.log" 2>&1; then
  echo 'Expected an invalid migration preflight response to fail closed' >&2
  exit 1
fi
grep -q 'invalid response' "$fixture_root/invalid-preflight-output.log"

deferred_predeploy_log="$fixture_root/deferred-predeploy-queries.log"
deferred_predeploy_output="$fixture_root/deferred-predeploy-output.log"
PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$deferred_dir" \
  MIGRATION_PHASE=predeploy \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$deferred_predeploy_log" \
  FAKE_INITIAL_RESPONSE='[]' \
  bash "$applier" >"$deferred_predeploy_output"
grep -q 'deferred until postdeploy: 20260827140000' "$deferred_predeploy_output"
grep -q 'deferred until postdeploy: 20260828091000' "$deferred_predeploy_output"
grep -q 'deferred until postdeploy: 20260828101000' "$deferred_predeploy_output"
grep -q 'deferred until postdeploy: 20260828110000' "$deferred_predeploy_output"
grep -q 'deferred until postdeploy: 20260828110100' "$deferred_predeploy_output"
grep -q 'deferred until postdeploy: 20260828120000' "$deferred_predeploy_output"
grep -q 'deferred until postdeploy: 20260828130000' "$deferred_predeploy_output"
grep -q 'deferred until postdeploy: 20260828151000' "$deferred_predeploy_output"
grep -q 'deferred until postdeploy: 20260828190000' "$deferred_predeploy_output"
grep -q 'applied:         20260828140000  ordinary_follow_up' "$deferred_predeploy_output"
grep -q 'applied:         20260828150000  prepare_storefront_order_delivery_columns' "$deferred_predeploy_output"
grep -q 'applied:         20260828151100  prepare_storefront_order_delivery_metadata_persistence' "$deferred_predeploy_output"
grep -q 'applied:         20260828160000  persist_quiz_reserved_order_delivery_metadata' "$deferred_predeploy_output"
grep -q 'applied:         20260828160100  preserve_quiz_reserved_order_delivery_metadata' "$deferred_predeploy_output"
grep -q 'applied:         20260828160200  limit_quiz_reserved_order_delivery_validation_to_redemption' "$deferred_predeploy_output"
grep -q 'applied:         20260828170000  prepare_storefront_order_hash_version_context' "$deferred_predeploy_output"
grep -q 'Migrations summary: 7 applied, 0 skipped, 9 deferred.' "$deferred_predeploy_output"
if grep -q "SELECT 'delivery-metadata'" "$deferred_predeploy_log" || \
  grep -q "SELECT 'context'" "$deferred_predeploy_log" || \
  grep -q "SELECT 'quiz-context'" "$deferred_predeploy_log" || \
  grep -q "SELECT 'hash-stamping'" "$deferred_predeploy_log" || \
  grep -q "SELECT 'hash-stamping-finalizer'" "$deferred_predeploy_log" || \
  grep -q "SELECT 'replay-context'" "$deferred_predeploy_log" || \
  grep -q "SELECT 'replay-scope'" "$deferred_predeploy_log" || \
  grep -q "SELECT 'pickup-location'" "$deferred_predeploy_log" || \
  grep -q "SELECT 'delivery-metadata-enforcement-restore'" "$deferred_predeploy_log"; then
  echo 'Predeploy phase must not send deferred migration SQL' >&2
  exit 1
fi

deferred_postdeploy_log="$fixture_root/deferred-postdeploy-queries.log"
deferred_postdeploy_output="$fixture_root/deferred-postdeploy-output.log"
PATH="$fake_bin:$PATH" \
  MIGRATIONS_DIR="$deferred_dir" \
  MIGRATION_PHASE=postdeploy \
  SUPABASE_ACCESS_TOKEN=test \
  SUPABASE_PROJECT_REF=test \
  FAKE_QUERY_LOG="$deferred_postdeploy_log" \
  FAKE_INITIAL_RESPONSE='[]' \
  bash "$applier" >"$deferred_postdeploy_output"
grep -q 'applied:         20260827140000  enforce_storefront_order_delivery_metadata' "$deferred_postdeploy_output"
grep -q 'applied:         20260828091000  harden_storefront_order_rpc_context_and_replays' "$deferred_postdeploy_output"
grep -q 'applied:         20260828101000  allow_legacy_quiz_award_order_context' "$deferred_postdeploy_output"
grep -q 'applied:         20260828110000  prepare_storefront_order_hash_stamping' "$deferred_postdeploy_output"
grep -q 'applied:         20260828110100  finalize_storefront_order_hash_stamping' "$deferred_postdeploy_output"
grep -q 'applied:         20260828120000  enforce_storefront_order_replay_route_context' "$deferred_postdeploy_output"
grep -q 'applied:         20260828130000  scope_storefront_order_replay_route_context' "$deferred_postdeploy_output"
grep -q 'applied:         20260828151000  enforce_storefront_airport_pickup_location' "$deferred_postdeploy_output"
grep -q 'applied:         20260828151100  prepare_storefront_order_delivery_metadata_persistence' "$deferred_postdeploy_output"
grep -q 'applied:         20260828160000  persist_quiz_reserved_order_delivery_metadata' "$deferred_postdeploy_output"
grep -q 'applied:         20260828160100  preserve_quiz_reserved_order_delivery_metadata' "$deferred_postdeploy_output"
grep -q 'applied:         20260828160200  limit_quiz_reserved_order_delivery_validation_to_redemption' "$deferred_postdeploy_output"
grep -q 'applied:         20260828170000  prepare_storefront_order_hash_version_context' "$deferred_postdeploy_output"
grep -q 'applied:         20260828190000  restore_storefront_order_delivery_metadata_enforcement' "$deferred_postdeploy_output"
grep -q "SELECT 'delivery-metadata'" "$deferred_postdeploy_log"
grep -q "SELECT 'context'" "$deferred_postdeploy_log"
grep -q "SELECT 'quiz-context'" "$deferred_postdeploy_log"
grep -q "SELECT 'hash-stamping'" "$deferred_postdeploy_log"
grep -q "SELECT 'hash-stamping-finalizer'" "$deferred_postdeploy_log"
grep -q "SELECT 'replay-context'" "$deferred_postdeploy_log"
grep -q "SELECT 'replay-scope'" "$deferred_postdeploy_log"
grep -q "SELECT 'pickup-location'" "$deferred_postdeploy_log"
grep -q "SELECT 'delivery-metadata-persistence'" "$deferred_postdeploy_log"
grep -q "SELECT 'quiz-reserved-delivery-metadata'" "$deferred_postdeploy_log"
grep -q "SELECT 'quiz-reserved-delivery-metadata-preserve'" "$deferred_postdeploy_log"
grep -q "SELECT 'quiz-reserved-delivery-validation-scope'" "$deferred_postdeploy_log"
grep -q "SELECT 'hash-version-context'" "$deferred_postdeploy_log"
grep -q "SELECT 'delivery-metadata-enforcement-restore'" "$deferred_postdeploy_log"
jq -e -s \
  --arg delivery "SELECT 'delivery-metadata';" \
  --arg context "SELECT 'context';" \
  --arg hash "SELECT 'hash-stamping';" \
  --arg hash_finalizer "SELECT 'hash-stamping-finalizer';" \
  --arg broad "SELECT 'replay-context';" \
  --arg scoped "SELECT 'replay-scope';" \
  '[.[].query | select(contains($delivery) and contains($context) and contains($hash) and contains($hash_finalizer))] | length == 1' \
  "$deferred_postdeploy_log" >/dev/null
jq -e -s \
  --arg hash "SELECT 'hash-stamping';" \
  --arg hash_finalizer "SELECT 'hash-stamping-finalizer';" \
  '[.[].query | select(contains($hash) and contains($hash_finalizer))] | length == 1' \
  "$deferred_postdeploy_log" >/dev/null
jq -e -s \
  --arg quiz "SELECT 'quiz-reserved-delivery-metadata';" \
  --arg preserve "SELECT 'quiz-reserved-delivery-metadata-preserve';" \
  --arg scope "SELECT 'quiz-reserved-delivery-validation-scope';" \
  '[.[].query | select(contains($quiz) and contains($preserve) and contains($scope))] | length == 1' \
  "$deferred_postdeploy_log" >/dev/null
jq -e -s \
  --arg scope "SELECT 'quiz-reserved-delivery-validation-scope';" \
  '[.[].query | select(contains($scope))] | length == 1' \
  "$deferred_postdeploy_log" >/dev/null
jq -e -s \
  --arg broad "SELECT 'replay-context';" \
  --arg scoped "SELECT 'replay-scope';" \
  '[.[].query | select(contains($broad) and contains($scoped))] | length == 1' \
  "$deferred_postdeploy_log" >/dev/null

echo 'Deferred migration phase tests passed'
