#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
fixture_dir=$(mktemp -d /tmp/oxygen-wallet-remainder-XXXXXX)
cleanup() { pg_ctl -D "$fixture_dir" -m fast stop >/dev/null 2>&1 || true; rm -rf "$fixture_dir"; }
trap cleanup EXIT
initdb -D "$fixture_dir" -A trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$fixture_dir" -l "$fixture_dir/server.log" -o "-k $fixture_dir -p 55598 -c listen_addresses=''" start >/dev/null
export PGHOST="$fixture_dir" PGPORT=55598 PGDATABASE=postgres
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/oxygen_wallet_remainder_fixture.sql
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20260427170000_deterministic_reverse_wallet_redemption_lookup.sql
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20260710213000_harden_manual_payment_idempotency.sql
for migration in supabase/migrations/*oxygen*.sql; do
 # Abandoned-order housekeeping patches an unrelated non-Oxygen function.
 if [[ "${migration##*/}" > '20261107161000' || "$migration" == *20261103000100* ]]; then continue; fi
 psql -Xq -v ON_ERROR_STOP=1 -f "$migration" >"$fixture_dir/migration.log" 2>&1 || { cat "$fixture_dir/migration.log"; echo "$migration"; exit 1; }
done
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261107160000_record_order_store_credit.sql
if [[ "${1:-}" != '--baseline' ]]; then
 psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261107161000_oxygen_wallet_remainder_funding.sql
 psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261111180000_preserve_oxygen_order_settlement_paths.sql
fi
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/oxygen_wallet_remainder.sql
# Match the live credit-writer lock without waiting or deadlocking admission.
psql -Xq -v ON_ERROR_STOP=1 -c "BEGIN; SELECT oxygen_private.credit_admission_lock('00000000-0000-4000-8000-000000000017'); SELECT pg_sleep(1); COMMIT;" >"$fixture_dir/held-lock.log" &
lock_pid=$!
lock_ready=false
for attempt in {1..40}; do
 if psql -XAtqc "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted)" | rg -qx t; then lock_ready=true; break; fi
 sleep 0.02
done
if [[ "$lock_ready" != true ]]; then echo 'Credit writer lock was not observed' >&2; exit 1; fi
if psql -Xq -v ON_ERROR_STOP=1 -c "SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false); SET ROLE authenticated; SELECT public.oxygen_start_workflow('00000000-0000-4000-8000-000000000017');" >"$fixture_dir/contended.log" 2>&1; then
 echo 'Concurrent wallet writer did not fence Oxygen admission' >&2; exit 1
fi
rg -q 'oxygen_credit_check_unavailable' "$fixture_dir/contended.log"
wait "$lock_pid"
# A first workflow held open must likewise stop a concurrent ledger mutation.
psql -Xq -v ON_ERROR_STOP=1 -c "BEGIN; SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false); SELECT public.oxygen_start_workflow('00000000-0000-4000-8000-000000000017'); SELECT pg_sleep(1); COMMIT;" >"$fixture_dir/admission.log" &
lock_pid=$!
lock_ready=false
for attempt in {1..40}; do
 if psql -XAtqc "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted)" | rg -qx t; then lock_ready=true; break; fi
 sleep 0.02
done
if [[ "$lock_ready" != true ]]; then echo 'Oxygen admission lock was not observed' >&2; exit 1; fi
if psql -Xq -v ON_ERROR_STOP=1 -c "UPDATE public.customer_wallet_transactions SET amount=21000 WHERE source_id='00000000-0000-4000-8000-000000000017';" >"$fixture_dir/contended.log" 2>&1; then
 echo 'Concurrent Oxygen admission did not fence wallet mutation' >&2; exit 1
fi
rg -q 'oxygen_credit_check_unavailable' "$fixture_dir/contended.log"
wait "$lock_pid"
echo 'Oxygen wallet remainder PostgreSQL regressions passed.'
