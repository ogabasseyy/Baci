#!/usr/bin/env bash
set -euo pipefail
fixture_dir=$(mktemp -d /tmp/oxygen-gateway-fence-XXXXXX)
cleanup() { pg_ctl -D "$fixture_dir" -m fast stop >/dev/null 2>&1 || true; rm -rf "$fixture_dir"; }
trap cleanup EXIT
initdb -D "$fixture_dir" -A trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$fixture_dir" -l "$fixture_dir/server.log" -o "-k $fixture_dir -p 55482 -c listen_addresses=''" start >/dev/null
export PGHOST="$fixture_dir" PGPORT=55482 PGDATABASE=postgres
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/oxygen_local_credit_admission_fixture.sql
psql -Xq -v ON_ERROR_STOP=1 -c 'CREATE TABLE public.transactions(order_id uuid,transaction_type text,status text)'
psql -Xq -v ON_ERROR_STOP=1 -c "ALTER TABLE oxygen_private.commands ADD COLUMN command jsonb NOT NULL DEFAULT '{\"action\":\"book\"}'; ALTER TABLE oxygen_private.payment_recovery ADD COLUMN action text NOT NULL DEFAULT 'resend_upfront'"
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261103070001_oxygen_local_credit_admission.sql
if [ "${OXYGEN_GATEWAY_WITH_PATCH:-1}" = 1 ]; then
 psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261103201000_oxygen_recorded_gateway_admission.sql
fi
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/oxygen_recorded_gateway_fence.sql

# A recorded transaction writer holding the existing payment lock cannot race
# the Oxygen check; lock contention fails closed and committed evidence blocks.
psql -Xq -v ON_ERROR_STOP=1 -c "INSERT INTO public.orders VALUES ('00000000-0000-4000-8000-000000000013','paystack',0)"
psql -Xq -v ON_ERROR_STOP=1 -c "BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('baci_order_payment:00000000-0000-4000-8000-000000000013',0)); INSERT INTO public.transactions VALUES ('00000000-0000-4000-8000-000000000013','payment','pending'); SELECT pg_sleep(2); COMMIT" >"$fixture_dir/holder" &
holder=$!
for _ in {1..100}; do
 if psql -XAtqc "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted)" | grep -q t; then break; fi
 sleep .02
done
if psql -Xq -v ON_ERROR_STOP=1 -c "UPDATE public.orders SET payment_method='oxygen' WHERE id='00000000-0000-4000-8000-000000000013'" >"$fixture_dir/rejected" 2>&1; then
 echo 'Concurrent recorded payment unexpectedly admitted' >&2; exit 1
fi
grep -q oxygen_gateway_check_unavailable "$fixture_dir/rejected"
wait "$holder"
if psql -Xq -v ON_ERROR_STOP=1 -c "UPDATE public.orders SET payment_method='oxygen' WHERE id='00000000-0000-4000-8000-000000000013'" >"$fixture_dir/rejected" 2>&1; then
 echo 'Committed payment unexpectedly admitted' >&2; exit 1
fi
grep -q oxygen_gateway_payment_in_use "$fixture_dir/rejected"
