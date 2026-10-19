-- =============================================
-- REGRESSION TEST: Plan transfer interest-aware headroom
--   Attribution uses the ledger-backed balance the wallet displays
--   (principal + paid-interest postings): transfers past the displayed
--   remainder raise for reconciliation, interest-covered goals skip
--   definitively, and negative net interest never expands headroom.
--
-- USAGE:
--   psql $DATABASE_URL -f supabase/migrations/tests/plan_transfer_interest_headroom.sql
-- =============================================

BEGIN;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users(id) VALUES ('94000000-0000-4000-8000-000000000003'), ('94000000-0000-4000-8000-000000000005'), ('94000000-0000-4000-8000-000000000007');

CREATE FUNCTION pg_temp.assert_true(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;

INSERT INTO public.merchants(id,email) VALUES ('94000000-0000-4000-8000-000000000001','headroom-probe@example.com');
INSERT INTO public.products(id,merchant_id,name,price,status,stock_quantity) VALUES
  ('94000000-0000-4000-8000-000000000012','94000000-0000-4000-8000-000000000001','Headroom device',100000,'active',3);
INSERT INTO public.customers(id,merchant_id,user_id) VALUES
  ('94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000003'),
  ('94000000-0000-4000-8000-000000000004','94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000005'),
  ('94000000-0000-4000-8000-000000000006','94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000007');
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,product_id,title,status,source_mode,target_amount,current_amount,contribution_amount,contribution_frequency,start_date,maturity_date,terms_accepted_at,non_withdrawable_accepted_at) VALUES
  ('94000000-0000-4000-8000-000000000008','94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000012','Probe goal','active','manual',100000,90000,20000,'daily',current_date,current_date + 30,now(),now()),
  ('94000000-0000-4000-8000-000000000009','94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000004','94000000-0000-4000-8000-000000000012','Probe goal','active','manual',100000,95000,20000,'daily',current_date,current_date + 30,now(),now()),
  ('94000000-0000-4000-8000-000000000010','94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000006','94000000-0000-4000-8000-000000000012','Probe goal','active','manual',100000,90000,20000,'daily',current_date,current_date + 30,now(),now());
INSERT INTO piggyvest_staging.integrations(id,expected_provider_account_id,enabled) VALUES ('94000000-0000-4000-8000-000000000011','provider-acct-headroom-001',true);
INSERT INTO piggyvest_savings_ledger.bindings(goal_id,integration_id,merchant_id,customer_id,authorized_login,enabled) VALUES
  ('94000000-0000-4000-8000-000000000008','94000000-0000-4000-8000-000000000011','94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002','postgres',true),
  ('94000000-0000-4000-8000-000000000009','94000000-0000-4000-8000-000000000011','94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000004','postgres',true),
  ('94000000-0000-4000-8000-000000000010','94000000-0000-4000-8000-000000000011','94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000006','postgres',true);
INSERT INTO piggyvest_savings_ledger.operations(id,integration_id,merchant_id,customer_id,goal_id,command,evidence_id,reference_id) VALUES
  ('94000000-0000-4000-8000-000000000012','94000000-0000-4000-8000-000000000011','94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000008','{"kind":"credit_eligible_paid_interest","interestKobo":800000}','int-1',NULL),
  ('94000000-0000-4000-8000-000000000013','94000000-0000-4000-8000-000000000011','94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000004','94000000-0000-4000-8000-000000000009','{"kind":"credit_eligible_paid_interest","interestKobo":600000}','int-2',NULL),
  ('94000000-0000-4000-8000-000000000014','94000000-0000-4000-8000-000000000011','94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000006','94000000-0000-4000-8000-000000000010','{"kind":"credit_eligible_paid_interest","interestKobo":15000}','int-3',NULL),
  ('94000000-0000-4000-8000-000000000015','94000000-0000-4000-8000-000000000011','94000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000006','94000000-0000-4000-8000-000000000010','{"kind":"reverse_credit","interestKobo":0}','int-4','94000000-0000-4000-8000-000000000014');
INSERT INTO piggyvest_savings_ledger.postings(operation_id,account,amount_kobo) VALUES
  ('94000000-0000-4000-8000-000000000012','paid_interest',800000),
  ('94000000-0000-4000-8000-000000000013','paid_interest',600000),
  ('94000000-0000-4000-8000-000000000014','paid_interest',15000),
  ('94000000-0000-4000-8000-000000000015','paid_interest',-20000);

-- Displayed remainder is 2000 (100000 - 90000 - 8000): a 5000 transfer
-- fits principal but exceeds the displayed balance -> reconcile.
DO $$
BEGIN
  PERFORM public.allocate_plan_transfer_contribution(
    '94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001',
    500000,'provider-txn-display-excess-001','plan-transfer:provider-txn-display-excess-001');
  RAISE EXCEPTION 'transfer past the displayed remainder must raise';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> 'P0001' THEN RAISE; END IF;
END $$;

-- A 1500 transfer fits the displayed remainder -> projects.
SELECT pg_temp.assert_true(
  (SELECT success AND outcome = 'projected' AND projected_amount = 1500
   FROM public.allocate_plan_transfer_contribution(
     '94000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001',
     150000,'provider-txn-display-fit-001','plan-transfer:provider-txn-display-fit-001')),
  'Transfer within the displayed remainder projects'
);

-- Interest-covered goal (95000 + 6000 >= 100000) is not allocatable.
SELECT pg_temp.assert_true(
  (SELECT NOT success AND outcome = 'no_allocatable_goal'
   FROM public.allocate_plan_transfer_contribution(
     '94000000-0000-4000-8000-000000000004','94000000-0000-4000-8000-000000000001',
     100000,'provider-txn-covered-001','plan-transfer:provider-txn-covered-001')),
  'Interest-covered goal skips definitively'
);

-- Negative net interest (-5000 kobo) floors at zero: full principal
-- remainder stays projectable.
SELECT pg_temp.assert_true(
  (SELECT success AND outcome = 'projected' AND projected_amount = 10000
   FROM public.allocate_plan_transfer_contribution(
     '94000000-0000-4000-8000-000000000006','94000000-0000-4000-8000-000000000001',
     1000000,'provider-txn-negative-001','plan-transfer:provider-txn-negative-001')),
  'Negative net interest does not expand headroom'
);

ROLLBACK;
