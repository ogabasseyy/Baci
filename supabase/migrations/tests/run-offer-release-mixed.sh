#!/usr/bin/env bash
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1|::1) ;; *) echo 'Set PGHOST to a local disposable PostgreSQL server' >&2; exit 1 ;; esac
case "${PGHOSTADDR:-}" in ''|127.0.0.1|::1) ;; *) echo 'PGHOSTADDR must be local' >&2; exit 1 ;; esac
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"; db="codex_offer_mixed_$$"; created=false
sanitizer="$(mktemp)"
sed -n '/CREATE OR REPLACE FUNCTION private.build_safe_variant_inventory_event_context(/,/^[[:space:]]*\$\$;/p' "$root/supabase/migrations/20260615181534_serialized_variant_inventory.sql" > "$sanitizer"
cleanup() { rm -f "$sanitizer"; if "$created"; then dropdb --if-exists "$db" >/dev/null; fi; }; trap cleanup EXIT
createdb "$db"; created=true
psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/migrations/tests/offer_release_mixed_fixture.sql" -f "$sanitizer" -f "$root/supabase/migrations/20261101100140_lock_offer_release_item.sql" -f "$root/supabase/migrations/20261101161535_prune_released_offer_units_from_snapshot.sql" -f "$root/supabase/migrations/20261101161749_redvault_cleaned_offer_refund_routing.sql" -f "$root/supabase/migrations/tests/offer_release_mixed_assert.sql"
echo 'PASS mixed offer release'
