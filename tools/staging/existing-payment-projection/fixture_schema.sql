ALTER TABLE public.customer_savings_goals
  ADD current_amount numeric NOT NULL DEFAULT 0,
  ADD target_amount numeric NOT NULL DEFAULT 100,
  ADD status text NOT NULL DEFAULT 'active',
  ADD completed_at timestamptz, ADD cancelled_at timestamptz, ADD spent_at timestamptz,
  ADD updated_at timestamptz;
CREATE TABLE public.customer_savings_contributions (
  id uuid PRIMARY KEY, goal_id uuid, merchant_id uuid, customer_id uuid, amount numeric,
  source_type text, status text, processed_at timestamptz, idempotency_key text, metadata jsonb
);
CREATE TABLE piggyvest_staging.wallet_goal_mappings (
  integration_id uuid, merchant_id uuid, customer_id uuid, goal_id uuid,
  provider_wallet_id text, provider_customer_id text
);
INSERT INTO public.customers VALUES
  ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001');
INSERT INTO piggyvest_staging.integrations VALUES
  ('d91d9e87-8e0d-44de-9b84-1e1d709633d2','01M2381RG34HQJMHQKE7DWDACR',true);
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,current_amount) VALUES
  ('9f01153c-1589-4dde-b9aa-8f644a846832','10000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000002',0),
  ('430314fd-cd8b-4579-98d4-e9f345713dd6','10000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000002',100);
INSERT INTO piggyvest_savings_ledger.bindings
  SELECT id,'d91d9e87-8e0d-44de-9b84-1e1d709633d2',merchant_id,customer_id,
    'prefunded_treasury_operator',true FROM public.customer_savings_goals
  WHERE customer_id='10000000-0000-4000-8000-000000000002';
ALTER FUNCTION piggyvest_savings_ledger.check_balance() SECURITY DEFINER;
BEGIN;
SET SESSION AUTHORIZATION prefunded_treasury_operator;
SELECT piggyvest_savings_ledger.apply('d91d9e87-8e0d-44de-9b84-1e1d709633d2',
  '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
  '430314fd-cd8b-4579-98d4-e9f345713dd6',
  '{"operationId":"aaaaaaaa-0000-4000-8000-000000000001","kind":"credit_principal",
    "principalKobo":10000,"interestKobo":0,"evidenceId":"fixture-old-principal","referenceId":null}');
COMMIT;
RESET SESSION AUTHORIZATION;
