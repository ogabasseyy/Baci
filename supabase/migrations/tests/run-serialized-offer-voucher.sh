#!/usr/bin/env bash
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1|::1) ;; *) echo 'Set PGHOST to a local disposable PostgreSQL server' >&2; exit 1 ;; esac
case "${PGHOSTADDR:-}" in ''|127.0.0.1|::1) ;; *) echo 'PGHOSTADDR must be local' >&2; exit 1 ;; esac
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
db="codex_offer_voucher_$$"
definition="$(mktemp)"
guard="$(mktemp)"
created=false
cleanup() { rm -f "$definition" "$guard"; if "$created"; then dropdb --if-exists "$db" >/dev/null; fi; }
trap cleanup EXIT
createdb "$db"
created=true
awk '/^CREATE OR REPLACE FUNCTION private\.create_storefront_order_with_quiz_voucher\(/ { found++; printing=1 } printing { print } printing && /^\$function\$;$/ { printing=0 } END { if (found != 1 || printing) exit 1 }' "$root/supabase/migrations/20260711000000_quiz_voucher_reserved_order_absorbs_vat.sql" > "$definition"
awk '/^CREATE OR REPLACE FUNCTION private\.guard_order_items_offer_id_snapshot\(\)/ { found++; printing=1 } printing { print } printing && /^\$\$;$/ { printing=0 } END { if (found != 1 || printing) exit 1 }' "$root/supabase/migrations/20261019100000_storefront_order_item_offer_line_condition_identity.sql" > "$guard"
printf '%s\n' 'CREATE TRIGGER guard_order_offer BEFORE INSERT OR UPDATE ON public.order_items FOR EACH ROW EXECUTE FUNCTION private.guard_order_items_offer_id_snapshot();' >> "$guard"
psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/migrations/tests/serialized_offer_voucher_fixture.sql" -f "$guard" -f "$definition" -f "$root/supabase/migrations/20261101200000_serialized_offer_voucher_identity.sql" -f "$root/supabase/migrations/20261101201000_serialized_voucher_reserved_item_binding.sql" -f "$root/supabase/migrations/tests/${OFFER_VOUCHER_ASSERTION:-serialized_offer_voucher_identity_assert.sql}"
echo 'PASS serialized offer voucher checkout'
