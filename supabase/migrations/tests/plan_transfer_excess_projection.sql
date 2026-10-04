BEGIN;

CREATE FUNCTION pg_temp.assert_true(condition boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF; END $$;

-- Fixtures run as the session role (staging tables revoke service_role).
INSERT INTO public.merchants(id,email) VALUES ('93000000-0000-4000-8000-000000000001','wallet-binding@example.com');
INSERT INTO public.customers(id,merchant_id,user_id) VALUES
  ('93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000003');
INSERT INTO public.products(id,merchant_id,name,price,status,stock_quantity) VALUES
  ('93000000-0000-4000-8000-000000000008','93000000-0000-4000-8000-000000000001','Binding device',100000,'active',3);
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,product_id,title,status,source_mode,target_amount,current_amount) VALUES
  ('93000000-0000-4000-8000-000000000004','93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000008','Bound goal','active','manual',100000,0),
  ('93000000-0000-4000-8000-000000000005','93000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000008','Other goal','active','manual',100000,0);
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

DO $$
BEGIN
  BEGIN
    PERFORM public.allocate_plan_transfer_contribution(
      '93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000001',
      10000001,'provider-excess','plan-transfer:provider-excess',
      'pvb-wallet-bound-001','pv-customer-001');
    RAISE EXCEPTION 'expected reconciliation refusal' USING ERRCODE = 'XX000';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'plan transfer exceeds remaining goal amount; reconciliation required' THEN
      RAISE;
    END IF;
  END;
END $$;
SELECT pg_temp.assert_true(
  (SELECT current_amount = 0 FROM public.customer_savings_goals
   WHERE id = '93000000-0000-4000-8000-000000000004'),
  'Overpayment must not partially increase the goal');
SELECT pg_temp.assert_true(
  NOT EXISTS (SELECT 1 FROM public.customer_savings_contributions
    WHERE idempotency_key = 'plan-transfer:provider-excess'),
  'Overpayment must remain unprojected for reconciliation');
SELECT pg_temp.assert_true(
  (SELECT success AND projected_amount = 100000 FROM public.allocate_plan_transfer_contribution(
    '93000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000001',
    10000000,'provider-exact','plan-transfer:provider-exact',
    'pvb-wallet-bound-001','pv-customer-001')),
  'Exact remaining amount projects in full');
ROLLBACK;
