#!/usr/bin/env bash
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1|::1) ;; *) echo 'Set PGHOST to a local disposable PostgreSQL server' >&2; exit 1 ;; esac
case "${PGHOSTADDR:-}" in ''|127.0.0.1|::1) ;; *) echo 'PGHOSTADDR must be local' >&2; exit 1 ;; esac
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
db="codex_offer_voucher_$$"
definition="$(mktemp)"
guard="$(mktemp)"
claim="$(mktemp)"
events="$(mktemp)"
created=false
cleanup() { rm -f "$definition" "$guard" "$claim" "$events"; if "$created"; then dropdb --if-exists "$db" >/dev/null; fi; }
trap cleanup EXIT
createdb "$db"
created=true
awk '/^CREATE OR REPLACE FUNCTION private\.create_storefront_order_with_quiz_voucher\(/ { found++; printing=1 } printing { print } printing && /^\$function\$;$/ { printing=0 } END { if (found != 1 || printing) exit 1 }' "$root/supabase/migrations/20260711000000_quiz_voucher_reserved_order_absorbs_vat.sql" > "$definition"
awk '/^CREATE OR REPLACE FUNCTION private\.guard_order_items_offer_id_snapshot\(\)/ { found++; printing=1 } printing { print } printing && /^\$\$;$/ { printing=0 } END { if (found != 1 || printing) exit 1 }' "$root/supabase/migrations/20261019100000_storefront_order_item_offer_line_condition_identity.sql" > "$guard"
extractor="$root/supabase/migrations/tests/extract-serialized-fixture-function.awk"
inventory_migration="$root/supabase/migrations/20260615181534_serialized_variant_inventory.sql"
{
  for function_name in private.build_safe_variant_inventory_event_context private.record_variant_inventory_event private.sync_serialized_stock private.on_variant_inventory_change; do
    awk -v function_name="$function_name" -f "$extractor" "$inventory_migration"
  done
  printf '%s\n' 'CREATE TRIGGER trg_sync_variant_inventory_stock AFTER INSERT OR DELETE OR UPDATE OF status,variant_id ON public.variant_inventory FOR EACH ROW EXECUTE FUNCTION private.on_variant_inventory_change();'
} > "$events"
node "$root/supabase/tests/serialized_variant_inventory_concurrency_fixture_functions.mjs" "$root" |
  awk -v function_name=private.claim_variant_inventory_units_for_order_item_internal -f "$extractor" > "$claim"
{
printf '%s\n' 'CREATE TRIGGER guard_order_offer BEFORE INSERT OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION private.guard_order_items_offer_id_snapshot();'
awk '/^CREATE OR REPLACE FUNCTION private\.enforce_order_item_product_offer\(\)/ { found++; printing=1 } printing { print } printing && /^END \$\$;$/ { printing=0 } END { if (found != 1 || printing) exit 1 }' "$root/supabase/migrations/20261015130500_commerce_cart_condition_order_pricing.sql"
printf '%s\n' 'CREATE TRIGGER enforce_order_item_product_offer BEFORE INSERT OR UPDATE OF product_offer_id,order_id,product_id,variant_id,condition ON public.order_items FOR EACH ROW EXECUTE FUNCTION private.enforce_order_item_product_offer();'
} >> "$guard"
psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/migrations/tests/serialized_offer_voucher_fixture.sql" -f "$events" -f "$claim" -f "$root/supabase/migrations/20261101160000_serialized_offer_claims.sql" -f "$guard" -f "$definition" -f "$root/supabase/migrations/20260830150000_bind_quiz_voucher_order_item_ordinal.sql" -f "$root/supabase/migrations/20261101200000_serialized_offer_voucher_identity.sql" -f "$root/supabase/migrations/20261101201000_serialized_voucher_reserved_item_binding.sql" -f "$root/supabase/migrations/20261101205118_serialized_offer_quiz_voucher_transfer.sql" -f "$root/supabase/migrations/tests/${OFFER_VOUCHER_ASSERTION:-serialized_offer_voucher_identity_assert.sql}"
echo 'PASS serialized offer voucher checkout'
