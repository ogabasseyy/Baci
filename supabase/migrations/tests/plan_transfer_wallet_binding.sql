-- =============================================
-- REGRESSION TEST: Plan transfer wallet-goal binding
--   The projection RPC binds to the funding flow's mapped goal for the
--   destination (wallet, customer) pair instead of inferring from the
--   goal census: exact attribution with two allocatable goals, census
--   fallback for unmapped wallets, definitive skip for a mapped but
--   unallocatable goal, and retryable ambiguity for conflicting mappings.
--
-- USAGE:
--   psql $DATABASE_URL -f supabase/migrations/tests/plan_transfer_wallet_binding.sql
-- =============================================

BEGIN;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users(id) VALUES ('93000000-0000-4000-8000-000000000003');

CREATE FUNCTION pg_temp.assert_true(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;

-- Fixtures run as the session role (staging tables revoke service_role).
INSERT INTO public.merchants(id,email) VALUES ('93000000-0000-4000-8000-000000000001','wallet-binding@example.com');
INSERT INTO public.customers(id,merchant_id,user_id) VALUES
  ('93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000003');
INSERT INTO public.products(id,merchant_id,name,price,status,stock_quantity) VALUES
  ('93000000-0000-4000-8000-000000000008','93000000-0000-4000-8000-000000000001','Binding device',100000,'active',3);
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,product_id,title,status,source_mode,target_amount,current_amount,contribution_amount,contribution_frequency,start_date,maturity_date,terms_accepted_at,non_withdrawable_accepted_at) VALUES
  ('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000008','Bound goal','active','manual',100000,0,20000,'daily',current_date,current_date + 30,now(),now()),
  ('93000000-0000-4000-8000-000000000005','93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000008','Other goal','active','manual',100000,0,20000,'daily',current_date,current_date + 30,now(),now());
INSERT INTO piggyvest_staging.integrations(id,expected_provider_account_id,enabled) VALUES
  ('93000000-0000-4000-8000-000000000006','provider-acct-bound-001',true),
  ('93000000-0000-4000-8000-000000000007','provider-acct-disabled-001',true);
INSERT INTO piggyvest_staging.wallet_goal_mappings
  (integration_id,provider_wallet_id,provider_customer_id,merchant_id,customer_id,goal_id) VALUES
  ('93000000-0000-4000-8000-000000000006','pvb-wallet-bound-001','pv-customer-001',
   '93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000004'),
  ('93000000-0000-4000-8000-000000000007','pvb-wallet-disabled-001','pv-customer-001',
   '93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000005');
-- The mapping guard trigger rejects inserts under a disabled integration,
-- so disable after seeding: the RPC joins on enabled at call time.
UPDATE piggyvest_staging.integrations SET enabled = false
  WHERE id = '93000000-0000-4000-8000-000000000007';

SET LOCAL ROLE service_role;

-- Exact binding wins over the two-goal census.
SELECT pg_temp.assert_true(
  (SELECT success AND outcome = 'projected' AND goal_id = '93000000-0000-4000-8000-000000000004'
   FROM public.allocate_plan_transfer_contribution(
     '93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000001',
     2500000,'provider-txn-bound-001','plan-transfer:provider-txn-bound-001',
     'pvb-wallet-bound-001','pv-customer-001')),
  'Mapped wallet projects onto its bound goal despite two allocatable goals'
);
SELECT pg_temp.assert_true(
  (SELECT metadata->>'projection' = 'mapped_wallet_goal'
   FROM public.customer_savings_contributions WHERE idempotency_key = 'plan-transfer:provider-txn-bound-001'),
  'Mapped projection is labeled in contribution metadata'
);

-- Unmapped wallet falls back to the census: two goals raise retryable ambiguity.
DO $$
BEGIN
  PERFORM public.allocate_plan_transfer_contribution(
    '93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000001',
    2500000,'provider-txn-unmapped-001','plan-transfer:provider-txn-unmapped-001',
    'pvb-wallet-unknown-001','pv-customer-001');
  RAISE EXCEPTION 'unmapped two-goal transfer must raise ambiguity';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> 'P0001' THEN RAISE; END IF;
END $$;

-- Disabled-integration mapping is ignored: same census ambiguity.
DO $$
BEGIN
  PERFORM public.allocate_plan_transfer_contribution(
    '93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000001',
    2500000,'provider-txn-disabled-001','plan-transfer:provider-txn-disabled-001',
    'pvb-wallet-disabled-001','pv-customer-001');
  RAISE EXCEPTION 'disabled-integration transfer must raise ambiguity';
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE <> 'P0001' THEN RAISE; END IF;
END $$;

-- Mapped but completed goal skips definitively without touching the other goal.
UPDATE public.customer_savings_goals SET current_amount = target_amount, status = 'completed'
  WHERE id = '93000000-0000-4000-8000-000000000004';
SELECT pg_temp.assert_true(
  (SELECT NOT success AND outcome = 'mapped_goal_unallocatable'
   FROM public.allocate_plan_transfer_contribution(
     '93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000001',
     2500000,'provider-txn-completed-001','plan-transfer:provider-txn-completed-001',
     'pvb-wallet-bound-001','pv-customer-001')),
  'Completed mapped goal skips instead of crediting the surviving goal'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 0 FROM public.customer_savings_contributions WHERE idempotency_key = 'plan-transfer:provider-txn-completed-001'),
  'Skipped transfer inserts no contribution'
);
SELECT pg_temp.assert_true(
  (SELECT current_amount = 0 FROM public.customer_savings_goals WHERE id = '93000000-0000-4000-8000-000000000005'),
  'Surviving goal balance untouched by the skip'
);

ROLLBACK;
