#!/usr/bin/env bash
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1|::1) ;; *) echo 'Set PGHOST to a local disposable PostgreSQL server' >&2; exit 1 ;; esac
case "${PGHOSTADDR:-}" in ''|127.0.0.1|::1) ;; *) echo 'PGHOSTADDR must be local' >&2; exit 1 ;; esac
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"; db="codex_redvault_offer_$$"; definition="$(mktemp)"; created=false
cleanup() { rm -f "$definition"; if "$created"; then dropdb --if-exists "$db" >/dev/null; fi; }; trap cleanup EXIT
createdb "$db"; created=true
awk '/^CREATE OR REPLACE FUNCTION private\.redvault_line_was_serialized\(/ { found++; printing=1 } printing { print } printing && /^[[:space:]]*\$\$;$/ { printing=0 } END { if (found != 1 || printing) exit 1 }' "$root/supabase/migrations/20260915103100_uba_redvault_round31_review_fixes.sql" > "$definition"
psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/migrations/tests/redvault_legacy_offer_routing_fixture.sql" -f "$definition" -f "$root/supabase/migrations/20261101100140_lock_offer_release_item.sql" -f "$root/supabase/migrations/20261101161535_prune_released_offer_units_from_snapshot.sql" -f "$root/supabase/migrations/20261101161749_redvault_cleaned_offer_refund_routing.sql" -f "$root/supabase/migrations/tests/redvault_legacy_offer_routing_assert.sql"
echo 'PASS redvault legacy offer routing'
