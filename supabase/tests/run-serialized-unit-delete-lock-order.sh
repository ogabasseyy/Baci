#!/usr/bin/env bash
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1|::1) ;; *) echo 'Set PGHOST to a local disposable server' >&2; exit 1 ;; esac
case "${PGHOSTADDR:-}" in ''|127.0.0.1|::1) ;; *) exit 1 ;; esac
root="$(cd "$(dirname "$0")/../.." && pwd)"
db="codex_unit_delete_lock_$$"
definition="$(mktemp)"
created=false
cleanup() { rm -f "$definition"; if "$created"; then dropdb --if-exists "$db" >/dev/null; fi; }
trap cleanup EXIT
createdb "$db"
created=true
awk -v function_name=private.delete_variant_inventory_unit -f "$root/supabase/migrations/tests/extract-serialized-fixture-function.awk" "$root/supabase/migrations/20260615181534_serialized_variant_inventory.sql" > "$definition"
psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/tests/serialized_variant_inventory_concurrency_fixture.sql" -f "$definition"
case "${TEST_LINE_ENDINGS:-lf}" in
  crlf) psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/tests/serialized_unit_delete_crlf_fixture.sql" ;;
  lf) ;;
  *) echo 'Invalid line ending fixture' >&2; exit 1 ;;
esac
if [[ "${TEST_BEFORE_FIX:-0}" != 1 ]]; then
  psql -v ON_ERROR_STOP=1 -q -d "$db" \
    -f "$root/supabase/migrations/20261101220459_normalize_serialized_delete_lock_source.sql" \
    -f "$root/supabase/migrations/20261101220459_normalize_serialized_delete_lock_source.sql" \
    -f "$root/supabase/migrations/20261101220500_serialized_unit_delete_lock_order.sql"
fi
psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/tests/serialized_unit_delete_lock_order.sql"
