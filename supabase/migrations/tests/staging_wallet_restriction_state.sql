-- =============================================
-- REGRESSION TEST: Staging wallet restriction state
--   Restriction flips for staging goal wallets (recorded only in
--   wallet_goal_mappings) persist on the mapping row, resolve through the
--   extended bridge, and fail closed: unknown/ambiguous wallets flip
--   nothing, identity updates stay blocked, and transfer allocation raises
--   for reconciliation on a restricted destination.
--
-- USAGE:
--   psql $DATABASE_URL -f supabase/migrations/tests/staging_wallet_restriction_state.sql
-- =============================================

BEGIN;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users(id) VALUES ('95000000-0000-4000-8000-000000000003');

CREATE FUNCTION pg_temp.assert_true(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;

INSERT INTO public.merchants(id,email) VALUES ('95000000-0000-4000-8000-000000000001','restriction-probe@example.com');
INSERT INTO public.products(id,merchant_id,name,price,status,stock_quantity) VALUES
  ('95000000-0000-4000-8000-000000000013','95000000-0000-4000-8000-000000000001','Restriction device',100000,'active',3);
INSERT INTO public.customers(id,merchant_id,user_id) VALUES
  ('95000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000003');
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,product_id,title,status,source_mode,target_amount,current_amount,contribution_amount,contribution_frequency,start_date,maturity_date,terms_accepted_at,non_withdrawable_accepted_at) VALUES
  ('95000000-0000-4000-8000-000000000004','95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000013','Probe goal','active','manual',100000,90000,20000,'daily',current_date,current_date + 30,now(),now()),
  ('95000000-0000-4000-8000-000000000005','95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000013','Probe goal','active','manual',100000,90000,20000,'daily',current_date,current_date + 30,now(),now()),
  ('95000000-0000-4000-8000-000000000006','95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000013','Probe goal','active','manual',100000,90000,20000,'daily',current_date,current_date + 30,now(),now());
INSERT INTO piggyvest_staging.integrations(id,expected_provider_account_id,enabled) VALUES
  ('95000000-0000-4000-8000-000000000011','provider-acct-1',true),
  ('95000000-0000-4000-8000-000000000012','provider-acct-2',true);

-- A fresh mapping resolves as ready.
SELECT pg_temp.assert_true(
  piggyvest_staging.record_wallet_goal_mapping(
    '95000000-0000-4000-8000-000000000011','wallet-restrict-1','customer-a',
    '95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000002',
    '95000000-0000-4000-8000-000000000004'),
  'Mapping records');
SELECT pg_temp.assert_true(
  (SELECT restriction_status = 'ready'
   FROM piggyvest_staging.resolve_wallet_mapping(
     '95000000-0000-4000-8000-000000000011','wallet-restrict-1','customer-a')),
  'Fresh mapping resolves as ready');

-- Restrict flip persists and resolves.
SELECT pg_temp.assert_true(
  public.apply_staging_wallet_restriction('wallet-restrict-1','restricted'),
  'Restrict flip applies');
SELECT pg_temp.assert_true(
  (SELECT restriction_status = 'restricted'
   FROM piggyvest_staging.resolve_wallet_mapping(
     '95000000-0000-4000-8000-000000000011','wallet-restrict-1','customer-a')),
  'Restricted mapping resolves as restricted');

-- Lift flip persists.
SELECT pg_temp.assert_true(
  public.apply_staging_wallet_restriction('wallet-restrict-1','ready'),
  'Lift flip applies');
SELECT pg_temp.assert_true(
  (SELECT restriction_status = 'ready'
   FROM piggyvest_staging.resolve_wallet_mapping(
     '95000000-0000-4000-8000-000000000011','wallet-restrict-1','customer-a')),
  'Lifted mapping resolves as ready');

-- Unknown wallet flips nothing.
SELECT pg_temp.assert_true(
  public.apply_staging_wallet_restriction('wallet-unknown','restricted') IS NOT DISTINCT FROM false,
  'Unknown wallet flips nothing');

-- Ambiguous wallet (same wallet under two enabled integrations) flips nothing.
SELECT piggyvest_staging.record_wallet_goal_mapping(
  '95000000-0000-4000-8000-000000000011','wallet-ambiguous','customer-a',
  '95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000006');
SELECT piggyvest_staging.record_wallet_goal_mapping(
  '95000000-0000-4000-8000-000000000012','wallet-ambiguous','customer-a',
  '95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000002',
  '95000000-0000-4000-8000-000000000005');
SELECT pg_temp.assert_true(
  public.apply_staging_wallet_restriction('wallet-ambiguous','restricted') IS NOT DISTINCT FROM false,
  'Ambiguous wallet flips nothing');

-- Identity updates stay blocked; only the status column may change.
DO $$
BEGIN
  UPDATE piggyvest_staging.wallet_goal_mappings SET goal_id = '95000000-0000-4000-8000-000000000005'
    WHERE provider_wallet_id = 'wallet-restrict-1';
  RAISE EXCEPTION 'identity update must stay blocked';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> '23514' THEN RAISE; END IF;
END $$;
UPDATE piggyvest_staging.wallet_goal_mappings SET restriction_status = 'restricted'
  WHERE provider_wallet_id = 'wallet-restrict-1';
SELECT pg_temp.assert_true(
  (SELECT restriction_status = 'restricted'
   FROM piggyvest_staging.wallet_goal_mappings WHERE provider_wallet_id = 'wallet-restrict-1'),
  'Status-only update passes the guard');

-- Allocation to a restricted destination raises for reconciliation.
DO $$
BEGIN
  PERFORM public.allocate_plan_transfer_contribution(
    '95000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000001',
    100000,'provider-txn-restricted-001','plan-transfer:provider-txn-restricted-001',
    'wallet-restrict-1','customer-a');
  RAISE EXCEPTION 'restricted destination must raise';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> 'P0001' THEN RAISE; END IF;
END $$;

-- After the lift, the same destination projects.
SELECT pg_temp.assert_true(
  public.apply_staging_wallet_restriction('wallet-restrict-1','ready'),
  'Lift flip applies before allocation');
SELECT pg_temp.assert_true(
  (SELECT success AND outcome = 'projected'
   FROM public.allocate_plan_transfer_contribution(
     '95000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000001',
     100000,'provider-txn-restricted-001','plan-transfer:provider-txn-restricted-001',
     'wallet-restrict-1','customer-a')),
  'Lifted destination projects');

ROLLBACK;
