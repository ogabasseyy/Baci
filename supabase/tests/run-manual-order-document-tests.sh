#!/usr/bin/env bash
# Isolated PostgreSQL domain replay. Never connects to a configured Supabase database.
set -euo pipefail

for executable in initdb pg_ctl psql; do
  command -v "$executable" >/dev/null || { echo "Required tool missing: $executable" >&2; exit 1; }
done
task_repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
task_pg_dir=$(mktemp -d /tmp/baci-manual-document-tests.XXXXXX)
task_pg_port=55489
task_pg_started=false
cleanup() {
  if [ "$task_pg_started" = true ]; then
    pg_ctl -D "$task_pg_dir" -m fast stop >/dev/null
  fi
  # Only remove this script's newly-created, validated disposable fixture.
  case "$task_pg_dir" in
    /tmp/baci-manual-document-tests.*)
      if [ -f "$task_pg_dir/PG_VERSION" ]; then rm -rf -- "$task_pg_dir"; fi ;;
  esac
}
trap cleanup EXIT
initdb -D "$task_pg_dir" --auth=trust --no-locale >/dev/null
pg_ctl -D "$task_pg_dir" -l "$task_pg_dir/server.log" \
  -o "-h '' -k $task_pg_dir -p $task_pg_port" start >/dev/null
task_pg_started=true
psql -X -h "$task_pg_dir" -p "$task_pg_port" -d postgres -v ON_ERROR_STOP=1 \
  -f "$task_repo/supabase/tests/manual_order_documents_fixture.sql" \
  -f "$task_repo/supabase/migrations/20260618200719_receipt_claims_for_import_notifications.sql" \
  -f "$task_repo/supabase/migrations/20260627090131_add_receipt_claim_tracking.sql" \
  -f "$task_repo/supabase/migrations/20260628212308_add_receipt_claim_channel_tracking.sql" \
  -f "$task_repo/supabase/migrations/20260713121000_terminalize_stale_order_notification_dispatches.sql" \
  -f "$task_repo/supabase/migrations/20260930160000_manual_order_document_notifications.sql" \
  -f "$task_repo/supabase/migrations/20260930160050_manual_order_document_claims.sql" \
  -f "$task_repo/supabase/migrations/20260930160060_manual_order_document_child_invalidation.sql" \
  -f "$task_repo/supabase/migrations/20260930160065_manual_order_document_merchant_rearm.sql" \
  -f "$task_repo/supabase/migrations/20260930160070_manual_order_document_item_triggers.sql" \
  -f "$task_repo/supabase/migrations/20260930160075_manual_order_document_domain_invalidation.sql" \
  -f "$task_repo/supabase/migrations/20260930160080_customer_payment_accounts_row_id.sql" \
  -f "$task_repo/supabase/migrations/20260930160100_verified_receipt_claim_redemption.sql" \
  -f "$task_repo/supabase/migrations/20260930160200_preview_receipt_claim_document_kind.sql" \
  -f "$task_repo/supabase/migrations/20260930160350_manual_document_snapshot_builders.sql" \
  -f "$task_repo/supabase/migrations/20260930160400_atomic_manual_document_dispatch.sql" \
  -f "$task_repo/supabase/tests/manual_order_documents_activation.sql" \
  -f "$task_repo/supabase/tests/manual_order_documents.sql" \
  -f "$task_repo/supabase/tests/manual_order_documents_rearm.sql" \
  -f "$task_repo/supabase/tests/manual_order_documents_redemption.sql" \
  -f "$task_repo/supabase/tests/manual_order_documents_dispatch.sql" \
  -f "$task_repo/supabase/tests/manual_order_documents_soft_deleted_linking.sql"
echo 'Manual-order document SQL/RLS regression checks passed.'
