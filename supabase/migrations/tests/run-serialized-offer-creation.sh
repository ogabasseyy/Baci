#!/usr/bin/env bash
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1|::1) ;; *) echo 'Set PGHOST to a local disposable PostgreSQL server' >&2; exit 1 ;; esac
case "${PGHOSTADDR:-}" in ''|127.0.0.1|::1) ;; *) echo 'PGHOSTADDR must be local' >&2; exit 1 ;; esac
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
db="codex_offer_creation_$$"
definition="$(mktemp)"
patches="$(mktemp)"
created=false
cleanup() { rm -f "$definition" "$patches"; if "$created"; then dropdb --if-exists "$db" >/dev/null; fi; }
trap cleanup EXIT
createdb "$db"
created=true
node "$root/supabase/tests/serialized_variant_inventory_concurrency_fixture_functions.mjs" "$root" > "$definition"
awk '/^CREATE OR REPLACE FUNCTION public\.get_effective_inventory_tracking_policy\(/ { found++; printing=1 } printing { print } printing && /^\$\$;$/ { printing=0 } END { if (found != 1 || printing) exit 1 }' "$root/supabase/migrations/20260615181534_serialized_variant_inventory.sql" >> "$definition"
awk '/^CREATE OR REPLACE FUNCTION private\.prepare_storefront_order_for_checkout\(/ { found++; printing=1 } printing { if ($0 == "    FOR UPDATE") print "    ORDER BY oi.product_id, oi.variant_id, oi.id"; print } printing && /^\$\$;$/ { printing=0 } END { if (found != 1 || printing) exit 1 }' "$root/supabase/migrations/20260926150000_fix_checkout_reuse_ambiguous_id.sql" >> "$definition"
awk '/^DO \$claim_exclusion_(prepare|confirm)_3734\$/ { printing=1; found++ } printing { print } printing && /^END \$claim_exclusion_(prepare|confirm)_3734\$;/ { printing=0 } END { if (found != 2 || printing) exit 1 }' "$root/supabase/migrations/20261027004500_storefront_order_serialized_claim_exclusion_3734.sql" > "$patches"
psql -v ON_ERROR_STOP=1 -q -d "$db" \
 -f "$root/supabase/tests/serialized_variant_inventory_concurrency_fixture.sql" \
 -f "$definition" \
 -f "$root/supabase/migrations/tests/serialized_offer_claim_fixture.sql" \
 -f "$root/supabase/migrations/tests/serialized_offer_confirmation_3813_fixture.sql" \
 -f "$root/supabase/migrations/tests/serialized_offer_reuse_fixture.sql" \
 -f "$root/supabase/migrations/tests/serialized_offer_creation_fixture.sql" \
 -f "$patches" \
 -f "$root/supabase/migrations/20261101160000_serialized_offer_claims.sql" \
 -f "$root/supabase/migrations/20261101165000_serialized_offer_confirmation.sql" \
 -f "$root/supabase/migrations/20261101190000_serialized_offer_order_protocol.sql" \
 -f "$root/supabase/migrations/20261101193000_serialized_offer_reuse_protocol.sql" \
 -f "$root/supabase/migrations/20261101194500_serialized_offer_order_creation_protocol.sql" \
 -f "$root/supabase/migrations/20261101195000_serialized_offer_order_creation_gate.sql" \
 -f "$root/supabase/migrations/tests/${OFFER_CREATION_ASSERTION:-serialized_offer_creation_assert.sql}"
echo 'PASS serialized offer order creation'
