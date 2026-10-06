CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
ALTER TABLE public.customers ADD COLUMN user_id uuid, ADD COLUMN deleted_at timestamptz;
ALTER TABLE public.customer_savings_goals ADD COLUMN current_amount numeric NOT NULL DEFAULT 100;
UPDATE public.customers SET user_id = '50000000-0000-4000-8000-000000000001';
CREATE TABLE public.customer_savings_contributions (
  id uuid PRIMARY KEY, goal_id uuid, merchant_id uuid, customer_id uuid,
  amount numeric, status text, processed_at timestamptz, created_at timestamptz
);
CREATE ROLE wrong_worker LOGIN;
INSERT INTO piggyvest_staging.wallet_goal_mappings VALUES (
  '40000000-0000-4000-8000-000000000001', 'public-wallet', 'provider-customer',
  '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001'
);
INSERT INTO public.merchants VALUES ('10000000-0000-4000-8000-000000000002');
INSERT INTO public.customers VALUES (
  '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000002', NULL
);
INSERT INTO public.customer_savings_goals VALUES (
  '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002', 100
);
INSERT INTO piggyvest_savings_ledger.bindings VALUES (
  '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  'harness_admin', true
);
SELECT piggyvest_savings_ledger.apply(
  '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  '{"operationId":"60000000-0000-4000-8000-000000000001","kind":"credit_principal","principalKobo":10000,"interestKobo":0,"evidenceId":"fixture-principal","referenceId":null}'
);
