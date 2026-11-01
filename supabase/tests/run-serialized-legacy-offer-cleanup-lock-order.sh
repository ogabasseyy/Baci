#!/usr/bin/env bash
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1|::1) ;; *) echo 'Set PGHOST to a local disposable server' >&2; exit 1 ;; esac
case "${PGHOSTADDR:-}" in ''|127.0.0.1|::1) ;; *) exit 1 ;; esac
root="$(cd "$(dirname "$0")/../.." && pwd)"
db="codex_offer_cleanup_lock_$$"
created=false
sanitizer="$(mktemp)"
sed -n '/CREATE OR REPLACE FUNCTION private.build_safe_variant_inventory_event_context(/,/^[[:space:]]*\$\$;/p' "$root/supabase/migrations/20260615181534_serialized_variant_inventory.sql" > "$sanitizer"
cleanup() { rm -f "$sanitizer"; if "$created"; then dropdb --if-exists "$db" >/dev/null; fi; }
trap cleanup EXIT
createdb "$db"
created=true
psql -v ON_ERROR_STOP=1 -q -d "$db" \
  -f "$root/supabase/migrations/tests/offer_release_mixed_fixture.sql" \
  -f "$sanitizer" \
  -f "$root/supabase/migrations/20261101100140_lock_offer_release_item.sql" \
  -f "$root/supabase/migrations/20261101161535_prune_released_offer_units_from_snapshot.sql" \
  -f "$root/supabase/migrations/20261101161749_redvault_cleaned_offer_refund_routing.sql"
case "${TEST_LINE_ENDINGS:-lf}" in
  crlf) psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/tests/serialized_legacy_offer_cleanup_crlf_fixture.sql" ;;
  lf) ;;
  *) exit 1 ;;
esac
if [[ "${TEST_BEFORE_FIX:-0}" != 1 ]]; then
  psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/migrations/20261101225000_serialized_offer_cleanup_product_lock_order.sql"
fi
psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/tests/serialized_legacy_offer_cleanup_lock_order.sql"
