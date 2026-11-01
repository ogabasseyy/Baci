#!/usr/bin/env bash
set -euo pipefail
case "${PGHOST:-}" in /*|localhost|127.0.0.1|::1) ;; *) echo 'Set PGHOST to a local disposable PostgreSQL server' >&2; exit 1 ;; esac
case "${PGHOSTADDR:-}" in ''|127.0.0.1|::1) ;; *) echo 'PGHOSTADDR must be local' >&2; exit 1 ;; esac
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
db="codex_offer_quiz_$$"
definition="$(mktemp)"
created=false
cleanup() { rm -f "$definition"; if "$created"; then dropdb --if-exists "$db" >/dev/null; fi; }
trap cleanup EXIT
createdb "$db"
created=true
awk '/^CREATE OR REPLACE FUNCTION private\.reserve_quiz_product_prize_v2\(/ { found++; printing=1 } printing { print } printing && /^\$\$;$/ { printing=0 } END { if (found != 1 || printing) exit 1 }' "$root/supabase/migrations/20260804110000_quiz_final_results_and_product_winner.sql" > "$definition"
psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$root/supabase/migrations/tests/serialized_offer_quiz_fixture.sql" -f "$definition" -f "$root/supabase/migrations/20261101153500_serialized_offer_quiz_isolation.sql" -f "$root/supabase/migrations/tests/serialized_offer_quiz_assert.sql"
echo 'PASS serialized quiz prize isolation'
