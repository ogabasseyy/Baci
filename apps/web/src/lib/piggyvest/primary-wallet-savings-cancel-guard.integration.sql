\set ON_ERROR_STOP on
\ir primary-wallet-savings-dispatch.integration.sql
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::text $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-4000-8000-000000000003'::uuid $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
GRANT authenticated TO primary_authorizer_fixture, primary_evidence_fixture;
ALTER TABLE public.customer_savings_goals ADD COLUMN future_debits_cancelled_at timestamptz;
ALTER TABLE public.customer_savings_goals ADD COLUMN cancelled_at timestamptz;
ALTER TABLE public.customer_savings_goals ADD COLUMN updated_at timestamptz;
CREATE TABLE public.customer_savings_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),goal_id uuid,merchant_id uuid,customer_id uuid,
  event_type text,actor_type text,actor_id uuid,metadata jsonb DEFAULT '{}'
);
CREATE TABLE public.customer_savings_contributions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),goal_id uuid,merchant_id uuid,customer_id uuid,
  wallet_transaction_id uuid,amount numeric,source_type text,status text,processed_at timestamptz,
  idempotency_key text UNIQUE,metadata jsonb DEFAULT '{}'
);
\ir ../../../../../supabase/migrations/20260521131000_customer_device_savings_rpcs.sql
\ir ../../../../../supabase/migrations/20261007150000_piggyvest_primary_savings_settlement.sql
-- Baseline: without the guard, cancellation marks a goal 'cancelled'
-- while its first contribution is still dispatched but unsettled.
DO $$
DECLARE outcome record;
BEGIN
  SELECT * INTO outcome FROM public.cancel_customer_savings_goal_future_debits(
    '00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');
  IF outcome.success IS DISTINCT FROM true OR outcome.goal_status<>'cancelled' THEN RAISE EXCEPTION 'baseline cancel diverged'; END IF;
END $$;
\ir ../../../../../supabase/migrations/20261008091600_piggyvest_primary_savings_failed_release.sql
\ir ../../../../../supabase/migrations/20261008091700_piggyvest_primary_savings_cancel_guard.sql
-- Settlement of the in-flight transfer lands on the cancelled goal: the
-- funds stay recoverable by flipping it to 'paused' instead of hiding
-- them, and future debits stay cancelled.
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$
DECLARE
  proof jsonb := '{"operationId":"00000000-0000-4000-8000-000000000008","providerTransactionId":"transfer-proof","reference":"pvb-save-00000000-0000-4000-8000-000000000008","amountKobo":2000,"sourceWalletId":"wallet","destinationWalletId":"destination","businessId":"fixture-business"}';
  integration uuid := '00000000-0000-4000-8000-000000000004';
BEGIN
  IF piggyvest_primary.settle_savings(integration,'staging',proof)<>'confirmed' THEN RAISE EXCEPTION 'cancelled-goal settlement failed'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT status FROM public.customer_savings_goals WHERE id='00000000-0000-4000-8000-000000000006')<>'paused' THEN RAISE EXCEPTION 'settled funds hidden on cancelled goal'; END IF;
  IF (SELECT current_amount FROM public.customer_savings_goals WHERE id='00000000-0000-4000-8000-000000000006')<>20 THEN RAISE EXCEPTION 'cancelled-goal settlement miscredited'; END IF;
  IF (SELECT future_debits_cancelled_at FROM public.customer_savings_goals WHERE id='00000000-0000-4000-8000-000000000006') IS NULL THEN RAISE EXCEPTION 'settlement resumed debits'; END IF;
  IF (SELECT count(*) FROM public.customer_savings_contributions)<>1 THEN RAISE EXCEPTION 'cancelled-goal contribution missing'; END IF;
END $$;
-- Guard: cancellation raises while a primary operation is pending, for
-- both reserved and dispatched states, and succeeds once released.
INSERT INTO public.customer_savings_goals VALUES('00000000-0000-4000-8000-00000000000d','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','active',200,0,NULL,NULL,NULL);
INSERT INTO piggyvest_primary.savings_destinations(integration_id,goal_id,intent_id,provider_wallet_id,enabled)
  SELECT integration_id,'00000000-0000-4000-8000-00000000000d',id,'destination-guard',true FROM piggyvest_primary.onboarding_intents WHERE customer_id='00000000-0000-4000-8000-000000000002';
SET SESSION AUTHORIZATION primary_authorizer_fixture;
DO $$
DECLARE
  scope jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  request jsonb := '{"goalId":"00000000-0000-4000-8000-00000000000d","operationId":"00000000-0000-4000-8000-00000000000e","amountKobo":2000}';
BEGIN
  IF piggyvest_primary.reserve_savings(scope,request)->>'status'<>'claimed' THEN RAISE EXCEPTION 'guard reservation failed'; END IF;
  BEGIN
    PERFORM public.cancel_customer_savings_goal_future_debits(
      '00000000-0000-4000-8000-00000000000d','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'reserved transfer cancellable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%savings_goal_not_cancellable_pending_transfer%' THEN RAISE; END IF;
  END;
  IF NOT piggyvest_primary.manage_savings(scope,'00000000-0000-4000-8000-00000000000e','dispatch') THEN RAISE EXCEPTION 'guard dispatch failed'; END IF;
  BEGIN
    PERFORM public.cancel_customer_savings_goal_future_debits(
      '00000000-0000-4000-8000-00000000000d','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'dispatched transfer cancellable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%savings_goal_not_cancellable_pending_transfer%' THEN RAISE; END IF;
  END;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$
DECLARE
  proof jsonb := '{"operationId":"00000000-0000-4000-8000-00000000000e","providerTransactionId":"failed-guard","reference":"pvb-save-00000000-0000-4000-8000-00000000000e","amountKobo":2000,"sourceWalletId":"wallet","destinationWalletId":"destination-guard","businessId":"fixture-business"}';
  integration uuid := '00000000-0000-4000-8000-000000000004';
  outcome record;
BEGIN
  IF piggyvest_primary.release_failed_savings(integration,'staging',proof)<>'released' THEN RAISE EXCEPTION 'guard release failed'; END IF;
  SELECT * INTO outcome FROM public.cancel_customer_savings_goal_future_debits(
    '00000000-0000-4000-8000-00000000000d','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');
  IF outcome.success IS DISTINCT FROM true OR outcome.goal_status<>'cancelled' THEN RAISE EXCEPTION 'post-release cancel blocked'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT status FROM public.customer_savings_goals WHERE id='00000000-0000-4000-8000-00000000000d')<>'cancelled' THEN RAISE EXCEPTION 'guard goal not cancelled'; END IF;
  IF (SELECT count(*) FROM public.customer_savings_events WHERE goal_id='00000000-0000-4000-8000-00000000000d')<>1 THEN RAISE EXCEPTION 'guard cancel unevented'; END IF;
  IF NOT has_function_privilege('authenticated','public.cancel_customer_savings_goal_future_debits(uuid,uuid,uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'cancel grant lost'; END IF;
END $$;
-- Swap guard: a retarget recomputes target/completion from the
-- pre-settlement balance, so swapping under a pending transfer either
-- fails settlement capacity (stranding provider funds) or lands funds on
-- a target the customer no longer sees.
ALTER TABLE public.customer_savings_goals ADD COLUMN product_id uuid;
ALTER TABLE public.customer_savings_goals ADD COLUMN variant_id uuid;
ALTER TABLE public.customer_savings_goals ADD COLUMN title text;
ALTER TABLE public.customer_savings_goals ADD COLUMN product_snapshot jsonb;
ALTER TABLE public.customer_savings_goals ADD COLUMN completed_at timestamptz;
CREATE TABLE public.products(id uuid PRIMARY KEY,merchant_id uuid,status text);
CREATE TABLE public.product_variants(id uuid PRIMARY KEY,product_id uuid,merchant_id uuid);
INSERT INTO public.products VALUES('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000001','active');
INSERT INTO public.product_variants VALUES('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000001');
INSERT INTO public.customer_savings_goals VALUES('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','active',200,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO piggyvest_primary.savings_destinations(integration_id,goal_id,intent_id,provider_wallet_id,enabled)
  SELECT integration_id,'00000000-0000-4000-8000-000000000022',id,'destination-swap',true FROM piggyvest_primary.onboarding_intents WHERE customer_id='00000000-0000-4000-8000-000000000002';
\ir ../../../../../supabase/migrations/20260611120000_swap_customer_savings_goal_device.sql
SET SESSION AUTHORIZATION primary_authorizer_fixture;
DO $$
DECLARE
  scope jsonb := '{"merchantId":"00000000-0000-4000-8000-000000000001","customerId":"00000000-0000-4000-8000-000000000002","userId":"00000000-0000-4000-8000-000000000003","integrationId":"00000000-0000-4000-8000-000000000004","businessId":"fixture-business","environment":"staging"}';
  request jsonb := '{"goalId":"00000000-0000-4000-8000-000000000022","operationId":"00000000-0000-4000-8000-000000000023","amountKobo":2000}';
  outcome record;
BEGIN
  IF piggyvest_primary.reserve_savings(scope,request)->>'status'<>'claimed' THEN RAISE EXCEPTION 'swap reservation failed'; END IF;
  IF NOT piggyvest_primary.manage_savings(scope,'00000000-0000-4000-8000-000000000023','dispatch') THEN RAISE EXCEPTION 'swap dispatch failed'; END IF;
  SELECT * INTO outcome FROM public.swap_customer_savings_goal_device(
    '00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000021',
    'Swapped device','{}',200);
  IF outcome.success IS DISTINCT FROM true THEN RAISE EXCEPTION 'baseline swap diverged'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
\ir ../../../../../supabase/migrations/20261008092100_piggyvest_primary_savings_swap_guard.sql
SET SESSION AUTHORIZATION primary_authorizer_fixture;
DO $$ BEGIN
  BEGIN
    PERFORM public.swap_customer_savings_goal_device(
      '00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000021',
      'Swapped device','{}',200);
    RAISE EXCEPTION 'dispatched transfer swappable';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%savings_goal_not_swappable_pending_transfer%' THEN RAISE; END IF;
  END;
END $$;
RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION primary_evidence_fixture;
DO $$
DECLARE
  proof jsonb := '{"operationId":"00000000-0000-4000-8000-000000000023","providerTransactionId":"failed-swap","reference":"pvb-save-00000000-0000-4000-8000-000000000023","amountKobo":2000,"sourceWalletId":"wallet","destinationWalletId":"destination-swap","businessId":"fixture-business"}';
  integration uuid := '00000000-0000-4000-8000-000000000004';
  outcome record;
BEGIN
  IF piggyvest_primary.release_failed_savings(integration,'staging',proof)<>'released' THEN RAISE EXCEPTION 'swap release failed'; END IF;
  SELECT * INTO outcome FROM public.swap_customer_savings_goal_device(
    '00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000021',
    'Swapped device','{}',200);
  IF outcome.success IS DISTINCT FROM true THEN RAISE EXCEPTION 'post-release swap blocked'; END IF;
END $$;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
  IF (SELECT target_amount FROM public.customer_savings_goals WHERE id='00000000-0000-4000-8000-000000000022')<>200 THEN RAISE EXCEPTION 'swap target not applied'; END IF;
  IF (SELECT count(*) FROM public.customer_savings_events WHERE goal_id='00000000-0000-4000-8000-000000000022' AND event_type='device_swapped')<>2 THEN RAISE EXCEPTION 'swap history wrong'; END IF;
  IF NOT has_function_privilege('authenticated','public.swap_customer_savings_goal_device(uuid,uuid,uuid,uuid,uuid,uuid,text,jsonb,numeric)','EXECUTE') THEN RAISE EXCEPTION 'swap grant lost'; END IF;
END $$;
