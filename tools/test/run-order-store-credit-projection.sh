#!/usr/bin/env bash
set -euo pipefail
fixture_dir=$(mktemp -d /tmp/order-store-credit-XXXXXX)
cleanup() { pg_ctl -D "$fixture_dir" -m fast stop >/dev/null 2>&1 || true; rm -rf "$fixture_dir"; }
trap cleanup EXIT
initdb -D "$fixture_dir" -A trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$fixture_dir" -l "$fixture_dir/server.log" -o "-k $fixture_dir -p 55597 -c listen_addresses=''" start >/dev/null
export PGHOST="$fixture_dir" PGPORT=55597 PGDATABASE=postgres
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/order_store_credit_projection_fixture.sql
if [[ "${1:-}" != '--baseline' ]]; then
 psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261107160000_record_order_store_credit.sql
 psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261111190000_distinguish_store_credit_reconciliation.sql
 psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261111200000_fence_store_credit_replay_after_gateway.sql
fi
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/order_store_credit_projection.sql
# A competing payment writer cannot race the ledger projection. This is a
# disposable socket-only database, never a connected Supabase environment.
psql -Xq -v ON_ERROR_STOP=1 -c "BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('baci_order_payment:00000000-0000-4000-8000-000000000010',0)); SELECT pg_sleep(1); COMMIT;" >"$fixture_dir/held-lock.log" &
lock_pid=$!
lock_ready=false
for attempt in {1..30}; do
 if psql -XAtqc "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted)" | rg -qx t; then
  lock_ready=true
  break
 fi
 sleep 0.02
done
if [[ "$lock_ready" != true ]]; then
 echo 'Payment writer lock was not observed' >&2
 exit 1
fi
if psql -Xq -v ON_ERROR_STOP=1 -c "SELECT set_config('test.actor','00000000-0000-4000-8000-000000000003',false); SET ROLE authenticated; SELECT public.record_order_store_credit('00000000-0000-4000-8000-000000000010');" >"$fixture_dir/contended.log" 2>&1; then
 echo 'Concurrent payment writer did not fence credit projection' >&2
 exit 1
fi
rg -q 'Store credit retry required' "$fixture_dir/contended.log"
wait "$lock_pid"
