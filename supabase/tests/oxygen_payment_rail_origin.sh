#!/usr/bin/env bash
set -euo pipefail
fixture_dir=$(mktemp -d /tmp/oxygen-rail-origin-XXXXXX)
cleanup() { pg_ctl -D "$fixture_dir" -m fast stop >/dev/null 2>&1 || true; rm -rf "$fixture_dir"; }
trap cleanup EXIT
initdb -D "$fixture_dir" -A trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$fixture_dir" -l "$fixture_dir/server.log" -o "-k $fixture_dir -p 55489 -c listen_addresses=''" start >/dev/null
export PGHOST="$fixture_dir" PGPORT=55489 PGDATABASE=postgres
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/oxygen_local_credit_admission_fixture.sql
psql -Xq -v ON_ERROR_STOP=1 -c "ALTER TABLE oxygen_private.commands ADD COLUMN command jsonb NOT NULL DEFAULT '{}'; ALTER TABLE oxygen_private.payment_recovery ADD COLUMN action text NOT NULL DEFAULT 'check_status'"
psql -Xq -v ON_ERROR_STOP=1 -c "INSERT INTO public.oxygen_workflows VALUES ('10000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000003')"
if [ "${OXYGEN_RAIL_ORIGIN_WITH_PATCH:-1}" = 1 ]; then
 psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261104063000_oxygen_payment_rail_origin.sql
fi
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/oxygen_payment_rail_origin.sql

# Reproduce the gap: the gateway has read a non-Oxygen snapshot, but has not
# written a transaction. A concurrent switch must not let Oxygen book the
# same order even while the gateway request is still in flight.
psql -Xq -v ON_ERROR_STOP=1 -c "INSERT INTO public.orders VALUES ('00000000-0000-4000-8000-000000000021','card',0)"
psql -Xq -v ON_ERROR_STOP=1 -c "BEGIN; SELECT payment_method FROM public.orders WHERE id='00000000-0000-4000-8000-000000000021'; SELECT pg_sleep(2); COMMIT" >"$fixture_dir/gateway" &
gateway=$!
for _ in {1..100}; do
 if psql -XAtqc "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE query LIKE '%pg_sleep(2)%' AND state='active' AND pid<>pg_backend_pid())" | grep -q t; then break; fi
 sleep .02
done
if psql -Xq -v ON_ERROR_STOP=1 -c "UPDATE public.orders SET payment_method='oxygen' WHERE id='00000000-0000-4000-8000-000000000021'" >"$fixture_dir/rejected" 2>&1; then
 echo 'An in-flight gateway order entered Oxygen' >&2; exit 1
fi
grep -q oxygen_previous_payment_unresolved "$fixture_dir/rejected"
wait "$gateway"
