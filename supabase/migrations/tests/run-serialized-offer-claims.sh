#!/usr/bin/env bash
# Use a local disposable PostgreSQL server, never a production server.
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1|::1) ;; *) echo 'Set PGHOST to a local disposable PostgreSQL server' >&2; exit 1 ;; esac
case "${PGHOSTADDR:-}" in ''|127.0.0.1|::1) ;; *) echo 'PGHOSTADDR must be local' >&2; exit 1 ;; esac
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
db="codex_offer_claim_$$"
definition="$(mktemp)"
created=false
cleanup() { rm -f "$definition"; if "$created"; then dropdb --if-exists "$db" >/dev/null; fi; }
trap cleanup EXIT
createdb "$db"
created=true
export CODEX_OFFER_TEST_DB="$db"
export PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-$(id -un)}" PGPASSWORD="${PGPASSWORD:-}"
node "$root/supabase/tests/serialized_variant_inventory_concurrency_fixture_functions.mjs" "$root" > "$definition"
psql -v ON_ERROR_STOP=1 -q -d "$db" \
  -f "$root/supabase/tests/serialized_variant_inventory_concurrency_fixture.sql" \
  -f "$definition" \
  -f "$root/supabase/migrations/tests/serialized_offer_claim_fixture.sql" \
  -f "$root/supabase/migrations/20261101160000_serialized_offer_claims.sql" \
  -f "$root/supabase/migrations/tests/serialized_offer_claim_concurrency.sql" \
  -f "$root/supabase/migrations/tests/serialized_offer_claim_assert.sql"
echo 'PASS serialized offer claims'
