#!/usr/bin/env bash
set -euo pipefail
fixture_dir=$(mktemp -d /tmp/oxygen-local-credit-XXXXXX)
cleanup() { pg_ctl -D "$fixture_dir" -m fast stop >/dev/null 2>&1 || true; rm -rf "$fixture_dir"; }
trap cleanup EXIT
initdb -D "$fixture_dir" -A trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$fixture_dir" -l "$fixture_dir/server.log" -o "-k $fixture_dir -p 55483 -c listen_addresses=''" start >/dev/null
export PGHOST="$fixture_dir" PGPORT=55483 PGDATABASE=postgres
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/oxygen_local_credit_admission_fixture.sql
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261103070001_oxygen_local_credit_admission.sql
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/oxygen_local_credit_admission.sql
# Hold the exact admission lock as an in-flight credit write, then verify that
# Oxygen cannot enter under either the same or a stale transaction snapshot.
psql -Xq -v ON_ERROR_STOP=1 -c "BEGIN; SELECT oxygen_private.credit_admission_lock('00000000-0000-4000-8000-000000000003'); SELECT pg_sleep(1.5); COMMIT" >"$fixture_dir/lock" &
holder=$!
for _ in {1..100}; do
  if psql -XAtqc "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted)" | grep -q t; then break; fi
  sleep .02
done
if psql -Xq -v ON_ERROR_STOP=1 -c "INSERT INTO public.oxygen_workflows VALUES (gen_random_uuid(),'00000000-0000-4000-8000-000000000003')" >"$fixture_dir/rejected" 2>&1; then
  echo 'Concurrent workflow unexpectedly admitted' >&2; exit 1
fi
grep -q oxygen_credit_check_unavailable "$fixture_dir/rejected"
wait "$holder"
psql -Xq -v ON_ERROR_STOP=1 -c "INSERT INTO public.orders VALUES ('00000000-0000-4000-8000-000000000005','paystack',0)"
psql -Xq -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO public.oxygen_workflows VALUES (gen_random_uuid(),'00000000-0000-4000-8000-000000000005'); SELECT pg_sleep(1.5); COMMIT" >"$fixture_dir/workflow" &
holder=$!
for _ in {1..100}; do
  if psql -XAtqc "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted)" | grep -q t; then break; fi
  sleep .02
done
if psql -Xq -v ON_ERROR_STOP=1 -c "INSERT INTO public.customer_savings_redemptions(order_id) VALUES ('00000000-0000-4000-8000-000000000005')" >"$fixture_dir/rejected" 2>&1; then
  echo 'Concurrent savings debit unexpectedly admitted' >&2; exit 1
fi
grep -q oxygen_credit_check_unavailable "$fixture_dir/rejected"
wait "$holder"

psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/oxygen_local_credit_real_rpc_fixture.sql
# Install the actual RPC definitions without unrelated functions in the same file.
sed '/CREATE OR REPLACE FUNCTION public.finalize_store_credit_order_payment/,$d' supabase/migrations/20260521205531_customer_savings_order_redemptions.sql | psql -Xq -v ON_ERROR_STOP=1
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20260427160500_redeem_wallet_for_order_raise_on_invalid_amount.sql
psql -Xq -v ON_ERROR_STOP=1 -f supabase/tests/oxygen_local_credit_real_rpc.sql
psql -Xq -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO public.customers VALUES('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003');
INSERT INTO public.orders(id,payment_method,wallet_amount_used,merchant_id,customer_id) VALUES
('20000000-0000-4000-8000-000000000004','paystack',0,'20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001'),
('20000000-0000-4000-8000-000000000005','paystack',0,'20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001');
INSERT INTO public.customer_wallets VALUES(gen_random_uuid(),'20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',100,0,now());
INSERT INTO public.customer_savings_goals VALUES('20000000-0000-4000-8000-000000000006','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000007',NULL,'active',100,100,NULL,NULL,now());
INSERT INTO public.order_items VALUES('20000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000007',NULL);
SQL
# Actual savings RPC wins; the in-flight ledger insert holds the shared fence.
psql -Xq -v ON_ERROR_STOP=1 -c "BEGIN; SELECT set_config('request.jwt.claim.role','service_role',true); SELECT * FROM public.redeem_savings_for_order('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000006',20,'race-actual'); SELECT pg_sleep(1.5); COMMIT" >"$fixture_dir/actual-credit" &
holder=$!
for _ in {1..100}; do
 if psql -XAtqc "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted)" | grep -q t; then break; fi
 sleep .02
done
if psql -Xq -v ON_ERROR_STOP=1 -c "INSERT INTO public.oxygen_workflows VALUES (gen_random_uuid(),'20000000-0000-4000-8000-000000000004')" >"$fixture_dir/actual-rejected" 2>&1; then
 echo 'actual concurrent savings RPC was bypassed' >&2; exit 1
fi
grep -q oxygen_credit_check_unavailable "$fixture_dir/actual-rejected"
wait "$holder"
# Oxygen wins; actual wallet RPC must roll back its earlier wallet mutation.
psql -Xq -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO public.oxygen_workflows VALUES (gen_random_uuid(),'20000000-0000-4000-8000-000000000005'); SELECT pg_sleep(1.5); COMMIT" >"$fixture_dir/actual-workflow" &
holder=$!
for _ in {1..100}; do
 if psql -XAtqc "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted)" | grep -q t; then break; fi
 sleep .02
done
if psql -Xq -v ON_ERROR_STOP=1 -c "SELECT set_config('request.jwt.claim.role','service_role',false); SELECT * FROM public.redeem_wallet_for_order('20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000005',20,'race-actual')" >"$fixture_dir/actual-rejected" 2>&1; then
 echo 'actual concurrent wallet RPC was bypassed' >&2; exit 1
fi
grep -q oxygen_credit_check_unavailable "$fixture_dir/actual-rejected"
wait "$holder"
test "$(psql -XAtqc "SELECT available_balance FROM public.customer_wallets WHERE customer_id='20000000-0000-4000-8000-000000000001'")" = 100
