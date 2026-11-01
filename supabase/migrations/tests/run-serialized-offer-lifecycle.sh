#!/usr/bin/env bash
# Use a local disposable PostgreSQL server, never a production server.
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1|::1) ;; *) echo 'Set PGHOST to a local disposable PostgreSQL server' >&2; exit 1 ;; esac
case "${PGHOSTADDR:-}" in ''|127.0.0.1|::1) ;; *) echo 'PGHOSTADDR must be local' >&2; exit 1 ;; esac
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
db="codex_offer_lifecycle_$$"
definitions="$(mktemp)"
case "${1:-}" in
  '') assertions=(-f "$root/supabase/migrations/tests/serialized_offer_identity_concurrency.sql" -f "$root/supabase/migrations/tests/serialized_offer_assignment_concurrency.sql" -f "$root/supabase/migrations/tests/serialized_offer_lifecycle_assert.sql") ;;
  --release-race) assertions=(-f "$root/supabase/migrations/tests/serialized_offer_release_concurrency.sql") ;;
  *) echo 'Unknown test mode' >&2; exit 1 ;;
esac
created=false
cleanup() { rm -f "$definitions"; if "$created"; then dropdb --if-exists "$db" >/dev/null; fi; }
trap cleanup EXIT
createdb "$db"
created=true
export CODEX_OFFER_TEST_DB="$db"
export PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-$(id -un)}" PGPASSWORD="${PGPASSWORD:-}"
awk '
  /^CREATE OR REPLACE FUNCTION private\.list_variant_inventory_units\(/ { found++; printing=1 }
  printing { print }
  printing && /^\$\$;$/ { printing=0 }
  END { if (found != 1 || printing) exit 1 }
' "$root/supabase/migrations/20260615181534_serialized_variant_inventory.sql" > "$definitions"
node "$root/supabase/tests/serialized_variant_inventory_concurrency_fixture_functions.mjs" "$root" >> "$definitions"
awk '
  /^CREATE OR REPLACE FUNCTION (public\.get_effective_inventory_tracking_policy|private\.sync_serialized_stock|private\.on_variant_inventory_change)\(/ { found++; printing=1 }
  printing { print }
  printing && /^\$\$;$/ { printing=0 }
  END { if (found != 3 || printing) exit 1 }
' "$root/supabase/migrations/20260615181534_serialized_variant_inventory.sql" >> "$definitions"
psql -v ON_ERROR_STOP=1 -q -d "$db" \
  -f "$root/supabase/migrations/tests/serialized_offer_assignment_fixture.sql" \
  -f "$root/supabase/migrations/tests/serialized_offer_lifecycle_fixture.sql" \
  -f "$definitions" \
  -f "$root/supabase/migrations/tests/serialized_offer_real_stock_sync_fixture.sql" \
  -f "$root/supabase/migrations/20261101150000_fix_serialized_inventory_page_cursor.sql" \
  -f "$root/supabase/migrations/20261101153000_serialized_offer_assignment.sql" \
  -f "$root/supabase/migrations/20261101160000_serialized_offer_claims.sql" \
  -f "$root/supabase/migrations/20261101165000_serialized_offer_confirmation.sql" \
  "${assertions[@]}"
echo 'PASS serialized offer lifecycle'
