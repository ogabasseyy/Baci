#!/usr/bin/env bash
# Use a local disposable PostgreSQL server, never a production server.
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1|::1) ;; *) echo 'Set PGHOST to a local disposable PostgreSQL server' >&2; exit 1 ;; esac
case "${PGHOSTADDR:-}" in ''|127.0.0.1|::1) ;; *) echo 'PGHOSTADDR must be local' >&2; exit 1 ;; esac
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
db="codex_offer_confirmation_$$"
definition="$(mktemp)"
legacy_patch="$(mktemp)"
created=false
cleanup() { rm -f "$definition" "$legacy_patch"; if "$created"; then dropdb --if-exists "$db" >/dev/null; fi; }
trap cleanup EXIT
createdb "$db"
created=true
export CODEX_OFFER_TEST_DB="$db"
export PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-$(id -un)}" PGPASSWORD="${PGPASSWORD:-}"
node "$root/supabase/tests/serialized_variant_inventory_concurrency_fixture_functions.mjs" "$root" > "$definition"
awk '/^DO \$claim_exclusion_confirm_3734\$/ { printing=1; found++ } printing { print } printing && /^END \$claim_exclusion_confirm_3734\$;/ { printing=0 } END { if (found != 1 || printing) exit 1 }' "$root/supabase/migrations/20261027004500_storefront_order_serialized_claim_exclusion_3734.sql" > "$legacy_patch"
psql -v ON_ERROR_STOP=1 -q -d "$db" \
  -f "$root/supabase/tests/serialized_variant_inventory_concurrency_fixture.sql" \
  -f "$definition" \
  -f "$root/supabase/migrations/tests/serialized_offer_claim_fixture.sql" \
  -f "$root/supabase/migrations/tests/serialized_offer_confirmation_3813_fixture.sql" \
  -f "$legacy_patch" \
  -f "$root/supabase/migrations/20261101165000_serialized_offer_confirmation.sql" \
  -f "$root/supabase/migrations/20261101190000_serialized_offer_order_protocol.sql" \
  -f "$root/supabase/migrations/tests/serialized_offer_confirmation_protocol_fixture.sql" \
  -f "$root/supabase/migrations/tests/serialized_offer_confirmation_assert.sql"
echo 'PASS serialized offer confirmation'
