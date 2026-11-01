#!/usr/bin/env bash
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1|::1) ;; *) echo 'Set PGHOST to a local disposable PostgreSQL server' >&2; exit 1 ;; esac
case "${PGHOSTADDR:-}" in ''|127.0.0.1|::1) ;; *) echo 'PGHOSTADDR must be local' >&2; exit 1 ;; esac
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
db="codex_offer_protocol_proof_$$"; definition="$(mktemp)"; created=false
cleanup() { rm -f "$definition"; if "$created"; then dropdb --if-exists "$db" >/dev/null; fi; }; trap cleanup EXIT
createdb "$db"; created=true
for source in 20260923120000_guest_snapshot_inventory_proof.sql 20260923151000_sessionless_payment_reference_snapshot.sql; do
 awk '/^CREATE OR REPLACE FUNCTION public\.get_(guest_payment_reference_snapshot|sessionless_payment_reference_snapshot)\(/ { found++; printing=1 } printing { print } printing && /^\$\$;$/ { printing=0 } END { if (found != 1 || printing) exit 1 }' "$root/supabase/migrations/$source" >> "$definition"
done
psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/migrations/tests/offer_payment_proof_fixture.sql" -f "$root/supabase/migrations/tests/serialized_offer_payment_proof_fixture.sql" -f "$definition" -f "$root/supabase/migrations/20261101161438_legacy_offer_payment_proof.sql" -f "$root/supabase/migrations/20261101202000_serialized_offer_payment_proof.sql" -f "$root/supabase/migrations/tests/serialized_offer_payment_proof_assert.sql"
echo 'PASS serialized offer payment proof'
