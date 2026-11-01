#!/usr/bin/env bash
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1|::1) ;; *) echo 'Set PGHOST to a local disposable server' >&2; exit 1 ;; esac
case "${PGHOSTADDR:-}" in ''|127.0.0.1|::1) ;; *) exit 1 ;; esac
root="$(cd "$(dirname "$0")/../.." && pwd)"
db="codex_release_product_lock_$$"
definition="$(mktemp)"
created=false
cleanup() { rm -f "$definition"; if "$created"; then dropdb --if-exists "$db" >/dev/null; fi; }
trap cleanup EXIT
createdb "$db"
created=true
node "$root/supabase/tests/serialized_variant_inventory_concurrency_fixture_functions.mjs" "$root" > "$definition"
psql -v ON_ERROR_STOP=1 -q -d "$db" \
  -f "$root/supabase/tests/serialized_variant_inventory_concurrency_fixture.sql" \
  -f "$definition" \
  -f "$root/supabase/migrations/20260829002000_harden_serialized_inventory_release_ordering.sql" \
  -f "$root/supabase/migrations/20260830002000_serialize_sold_inventory_transition.sql" \
  -f "$root/supabase/migrations/20260927150000_order_unit_cursors_by_product_variant.sql"
if [[ "${TEST_BEFORE_FIX:-0}" != 1 ]]; then
  psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/migrations/20261101224000_serialized_release_product_lock_order.sql" -f "$root/supabase/migrations/20261101224100_serialized_sold_product_lock_order.sql"
fi
case "${TEST_TARGET_STATUS:-available}" in
  available|returned) psql -v ON_ERROR_STOP=1 -q -d "$db" -v "target_status=${TEST_TARGET_STATUS:-available}" -f "$root/supabase/tests/serialized_release_product_lock_order.sql" ;;
  sold) psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/tests/serialized_sold_product_lock_order.sql" ;;
  *) exit 1 ;;
esac
