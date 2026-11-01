#!/usr/bin/env bash
# Use a local disposable PostgreSQL server, never a production server.
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1|::1) ;; *) echo 'Set PGHOST to a local disposable PostgreSQL server' >&2; exit 1 ;; esac
case "${PGHOSTADDR:-}" in ''|127.0.0.1|::1) ;; *) echo 'PGHOSTADDR must be local' >&2; exit 1 ;; esac
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
db="codex_offer_assignment_$$"
definition="$(mktemp)"
created=false
cleanup() { rm -f "$definition"; if "$created"; then dropdb --if-exists "$db" >/dev/null; fi; }
trap cleanup EXIT
createdb "$db"
created=true
awk '
  /^CREATE OR REPLACE FUNCTION private\.list_variant_inventory_units\(/ { found++; printing=1 }
  printing { print }
  printing && /^\$\$;$/ { printing=0 }
  END { if (found != 1 || printing) exit 1 }
' "$root/supabase/migrations/20260615181534_serialized_variant_inventory.sql" > "$definition"
psql -v ON_ERROR_STOP=1 -q -d "$db" \
  -f "$root/supabase/migrations/tests/serialized_offer_assignment_fixture.sql" \
  -f "$definition" \
  -f "$root/supabase/migrations/20261101150000_fix_serialized_inventory_page_cursor.sql" \
  -f "$root/supabase/migrations/20261101153000_serialized_offer_assignment.sql" \
  -f "$root/supabase/migrations/20261101154000_serialized_offer_cache_invalidation.sql" \
  -f "$root/supabase/migrations/tests/serialized_offer_assignment_assert.sql"
echo 'PASS serialized offer assignment'
