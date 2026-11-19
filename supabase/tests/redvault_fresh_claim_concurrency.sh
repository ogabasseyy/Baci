#!/usr/bin/env bash
# Disposable synthetic schema; actual historical claim bodies, no provider calls.
set -euo pipefail
fixture_dir=$(mktemp -d /tmp/redvault-fresh-claim-XXXXXX)
cleanup() { pg_ctl -D "$fixture_dir" -m fast stop >/dev/null 2>&1 || true; rm -rf "$fixture_dir"; }
trap cleanup EXIT
initdb -D "$fixture_dir" -A trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$fixture_dir" -l "$fixture_dir/server.log" -o "-k $fixture_dir -p 55479 -c listen_addresses=''" start >/dev/null
export PGHOST="$fixture_dir" PGPORT=55479 PGDATABASE=postgres
export PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=5000'
python3 - "$fixture_dir/fixture.sql" <<'PY'
from pathlib import Path
import sys
history = Path('supabase/migrations/20260915101400_uba_redvault_round14_review_fixes.sql').read_text()
pilot = Path('supabase/migrations/20260928121500_uba_redvault_private_pilot_rpc_wrappers.sql').read_text()
def section(source, start, end):
    a = source.index(start)
    return source[a:source.index(end, a)]
v2 = section(history, 'CREATE FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v2(', 'ALTER FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v2')
v3 = section(history, 'CREATE FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(', 'ALTER FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3').replace('CREATE FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(', 'CREATE FUNCTION public.claim_redvault_initialization_v3_pre_pilot(', 1)
wrapper = section(pilot, 'CREATE FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(', 'ALTER FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3')
reconcile = section(history, 'CREATE OR REPLACE FUNCTION public.reconcile_storefront_redvault_payment_attempt_initialization(', 'ALTER FUNCTION public.reconcile_storefront_redvault_payment_attempt_initialization')
setup = '''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE postgres SUPERUSER;
CREATE SCHEMA auth; CREATE SCHEMA private;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated') $$;
CREATE TABLE private.uba_redvault_applications(id uuid, status text, merchant_id uuid, customer_email text, user_id uuid);
CREATE TABLE private.uba_redvault_payment_attempts(id uuid,application_id uuid,order_id uuid,reference text,amount_kobo bigint,currency text,quote_payload_hash text,state text,accepted_filter_policy jsonb,accepted_filter_policy_hash text,authorization_url text,paystack_subaccount_code text,platform_fee_kobo bigint,split_retained_shipping_kobo bigint,initialization_claimed_at timestamptz,initialized_at timestamptz);
CREATE TABLE public.orders(id uuid,shipping_platform_retained_amount numeric,shipping_funding_source text,shipping_provider text,shipping_pricing_version text);
CREATE FUNCTION private.redvault_attempt_filter_policy_valid(jsonb,text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION private.ensure_redvault_attempt_transaction_v2(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION private.assert_uba_redvault_private_pilot_active(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
'''
fixtures = '''INSERT INTO private.uba_redvault_applications VALUES('00000000-0000-4000-8000-000000000002','pending','00000000-0000-4000-8000-000000000003','buyer@example.test',NULL);
INSERT INTO private.uba_redvault_payment_attempts VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','fixture-ref',10000,'NGN','hash','created','{"bankCode":"033"}','hash',NULL,'ACCT_fixture',200,0,NULL,NULL);
'''
Path(sys.argv[1]).write_text(setup + v2 + v3 + wrapper + reconcile + fixtures)
PY
psql -Xq -v ON_ERROR_STOP=1 -f "$fixture_dir/fixture.sql"
psql -Xq -v ON_ERROR_STOP=1 -f supabase/migrations/20261103101511_redvault_fresh_claim_and_void_guard.sql
claims='{"storefront_order_context":"route","storefront_order_merchant_id":"00000000-0000-4000-8000-000000000003","storefront_redvault_customer_email":"buyer@example.test"}'
run_race() {
  local first_rpc=$1 second_rpc=$2 first_column=$3 second_column=$4
  psql -Xq -v ON_ERROR_STOP=1 -c "UPDATE private.uba_redvault_payment_attempts SET state='created',initialization_claimed_at=NULL;"
  psql -XqAt -v ON_ERROR_STOP=1 >"$fixture_dir/first" 2>&1 <<SQL &
BEGIN;
SELECT set_config('request.jwt.claims','$claims',true);
SELECT $first_column FROM public.$first_rpc('00000000-0000-4000-8000-000000000001');
SELECT pg_sleep(2);
COMMIT;
SQL
  local a=$!
  sleep .3
  PGAPPNAME=redvault_competing_claim psql -XqAt -v ON_ERROR_STOP=1 >"$fixture_dir/second" 2>&1 <<SQL &
SELECT set_config('request.jwt.claims','$claims',false);
SELECT $second_column FROM public.$second_rpc('00000000-0000-4000-8000-000000000001');
SQL
  local b=$! blocked=false
  for _ in {1..15}; do
    if [ "$(psql -XqAt -c "SELECT count(*) FROM pg_stat_activity WHERE application_name='redvault_competing_claim' AND wait_event_type='Lock'")" = 1 ]; then blocked=true; break; fi
    sleep .1
  done
  if [ "$blocked" != true ]; then echo 'competing claim did not wait for the lock'; exit 1; fi
  wait "$a" || { cat "$fixture_dir/first"; exit 1; }
  wait "$b" || { cat "$fixture_dir/second"; exit 1; }
  grep -qx 't' "$fixture_dir/first" || { cat "$fixture_dir/first"; exit 1; }
  grep -qx 'f' "$fixture_dir/second" || { cat "$fixture_dir/second"; exit 1; }
}
run_race claim_storefront_redvault_payment_attempt_initialization_v4 claim_storefront_redvault_payment_attempt_initialization_v3 initialization_fresh initialization_claimed
run_race claim_storefront_redvault_payment_attempt_initialization_v3 claim_storefront_redvault_payment_attempt_initialization_v4 initialization_claimed initialization_fresh
psql -Xq -v ON_ERROR_STOP=1 <<SQL
SELECT set_config('request.jwt.claims','$claims',false);
UPDATE private.uba_redvault_payment_attempts SET state='initializing',initialization_claimed_at=NULL;
DO \$\$ DECLARE result record; BEGIN
 SELECT * INTO result FROM public.claim_storefront_redvault_payment_attempt_initialization_v4('00000000-0000-4000-8000-000000000001');
 IF result.initialization_claimed IS DISTINCT FROM false OR result.initialization_fresh IS DISTINCT FROM false OR NOT EXISTS (
  SELECT 1 FROM private.uba_redvault_payment_attempts WHERE id='00000000-0000-4000-8000-000000000001'
   AND state='initializing' AND initialization_claimed_at IS NULL
 ) THEN RAISE EXCEPTION 'NULL lease reclaimed or changed'; END IF;
END \$\$;
SQL
psql -Xq -v ON_ERROR_STOP=1 <<'SQL'
UPDATE private.uba_redvault_applications
 SET user_id='00000000-0000-4000-8000-000000000005',customer_email='redvault-p12@example.com';
UPDATE private.uba_redvault_payment_attempts SET state='created',initialization_claimed_at=NULL;
INSERT INTO private.uba_redvault_payment_attempts
 (id,application_id,order_id,reference,amount_kobo,currency,quote_payload_hash,state,accepted_filter_policy,accepted_filter_policy_hash,authorization_url,paystack_subaccount_code,platform_fee_kobo,split_retained_shipping_kobo,initialization_claimed_at,initialized_at)
SELECT candidate.id,a.application_id,a.order_id,candidate.reference,a.amount_kobo,a.currency,a.quote_payload_hash,'initializing',a.accepted_filter_policy,a.accepted_filter_policy_hash,a.authorization_url,a.paystack_subaccount_code,a.platform_fee_kobo,a.split_retained_shipping_kobo,candidate.claimed_at,NULL
FROM private.uba_redvault_payment_attempts a CROSS JOIN (VALUES
 ('00000000-0000-4000-8000-000000000006'::uuid,'fixture-stale',now()-interval '10 minutes'),
 ('00000000-0000-4000-8000-000000000007'::uuid,'fixture-null',NULL::timestamptz)
) candidate(id,reference,claimed_at) WHERE a.id='00000000-0000-4000-8000-000000000001';
\i supabase/tests/uba_redvault_round12_initialization_lease.inc.sql
SELECT pg_temp.assert_redvault_initialization_leases(
 '00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000003',
 '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000006',
 '00000000-0000-4000-8000-000000000007');
SQL
printf '%s\n' 'REDVAULT v3/v4 concurrent claims: one winner in each ordering'
