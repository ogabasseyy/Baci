#!/usr/bin/env bash
# Run only against a local disposable PostgreSQL server.
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1|::1) ;; *) exit 1 ;; esac
case "${PGHOSTADDR:-}" in ''|127.0.0.1|::1) ;; *) exit 1 ;; esac
root="$(cd "$(dirname "$0")/../.." && pwd)"
db="codex_inventory_fields_$$"
definition="$(mktemp)"
created=false
cleanup() { rm -f "$definition"; if "$created"; then dropdb --if-exists "$db" >/dev/null; fi; }
trap cleanup EXIT
createdb "$db"
created=true
awk '/^CREATE OR REPLACE FUNCTION private\.list_variant_inventory_units\(/ { found++; printing=1 } printing { print } printing && /^\$\$;$/ { printing=0 } END { if (found != 1 || printing) exit 1 }' "$root/supabase/migrations/20260615181534_serialized_variant_inventory.sql" > "$definition"
psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/migrations/tests/serialized_inventory_pagination_fixture.sql" -c "ALTER TABLE public.variant_inventory ADD COLUMN notes text; UPDATE public.variant_inventory SET notes = 'keep this note';" -f "$definition" -f "$root/supabase/migrations/20261101145959_normalize_serialized_listing_line_endings.sql" -f "$root/supabase/migrations/20261101150000_fix_serialized_inventory_page_cursor.sql"
if [[ "${TEST_BEFORE_FIX:-0}" != 1 ]]; then
  psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/migrations/20261101213000_include_serialized_listing_edit_fields.sql"
fi
psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/tests/serialized_inventory_listing_fields.sql"
