#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
fixture_dir=$(mktemp -d /tmp/credit-direct-wallet-attempt-XXXXXX)
cleanup() { pg_ctl -D "$fixture_dir" -m fast stop >/dev/null 2>&1 || true; rm -rf "$fixture_dir"; }
trap cleanup EXIT
initdb -D "$fixture_dir" -A trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$fixture_dir" -l "$fixture_dir/server.log" -o "-k $fixture_dir -p 55599 -c listen_addresses=''" start >/dev/null
export PGHOST="$fixture_dir" PGPORT=55599 PGDATABASE=postgres
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/credit_direct_wallet_attempt_fixture.sql
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20260724100100_s2p_credit_direct_checkout_tokens.sql
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20260724100200_s2p_harden_set_credit_direct_session.sql
if [[ "${1:-}" != '--baseline' ]]; then
 psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261107165000_credit_direct_wallet_attempt_reservation.sql
 psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261110170000_allow_captured_credit_direct_wallet_cancellation.sql
 psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261111170000_accept_legacy_credit_direct_cancellation_spelling.sql
fi
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20260427170000_deterministic_reverse_wallet_redemption_lookup.sql
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/credit_direct_wallet_attempt.sql
# Hold a real consumed attempt open, simulating concurrent signing/lost response.
# The second session must be refused once the first transaction commits.
psql -Xq -v ON_ERROR_STOP=1 <<'SQL' >"$fixture_dir/first-attempt.log" &
BEGIN;
SELECT set_config('test.role','authenticated',false);
DO $$ DECLARE token record; BEGIN
 SELECT * INTO token FROM public.issue_credit_direct_checkout_token('00000000-0000-4000-8000-000000000016','wallet@example.com','00000000-0000-4000-8000-000000000002','concurrent-first','unguessable-tracking-token');
 PERFORM public.set_credit_direct_session(token.checkout_token,'00000000-0000-4000-8000-000000000016','00000000-0000-4000-8000-000000000002','concurrent-first',30000);
END $$;
SELECT pg_sleep(1);
COMMIT;
SQL
first_pid=$!
ready=false
for attempt in {1..50}; do
 if psql -XAtqc "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE query='SELECT pg_sleep(1);' AND state='active')" | rg -qx t; then ready=true; break; fi
 sleep 0.02
done
if [[ "$ready" != true ]]; then echo 'Concurrent financial attempt was not observed' >&2; exit 1; fi
if psql -Xq -v ON_ERROR_STOP=1 -c "SELECT public.issue_credit_direct_checkout_token('00000000-0000-4000-8000-000000000016','wallet@example.com','00000000-0000-4000-8000-000000000002','concurrent-second','unguessable-tracking-token');" >"$fixture_dir/second-attempt.log" 2>&1; then
 echo 'Concurrent signing created another lender session' >&2; exit 1
fi
rg -q 'credit_direct_wallet_attempt_pending' "$fixture_dir/second-attempt.log"
wait "$first_pid"
psql -Xq -v ON_ERROR_STOP=1 -c "SELECT public.test_assert((SELECT count(*)=1 FROM credit_direct_private.wallet_attempts WHERE order_id='00000000-0000-4000-8000-000000000016'),'exactly one concurrent financing attempt');"
echo 'Credit Direct wallet reservation PostgreSQL regressions passed.'
