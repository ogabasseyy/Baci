CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE ROLE authenticator NOINHERIT;
CREATE ROLE piggyvest_staging_ledger_worker LOGIN;
CREATE ROLE prefunded_treasury_operator LOGIN;
CREATE TABLE public.merchants (id uuid PRIMARY KEY);
CREATE TABLE public.customers (
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL REFERENCES public.merchants,
  user_id uuid, deleted_at timestamptz
);
CREATE TABLE public.customer_savings_goals (
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL REFERENCES public.merchants,
  customer_id uuid NOT NULL REFERENCES public.customers,
  current_amount numeric NOT NULL DEFAULT 100, status text NOT NULL DEFAULT 'active'
);
CREATE TABLE public.customer_savings_contributions (
  id uuid PRIMARY KEY, goal_id uuid, merchant_id uuid, customer_id uuid,
  amount numeric, status text, processed_at timestamptz, created_at timestamptz
);
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE SCHEMA piggyvest_staging;
CREATE TABLE piggyvest_staging.integrations (
  id uuid PRIMARY KEY, expected_provider_account_id text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.merchants VALUES ('10000000-0000-4000-8000-000000000001');
INSERT INTO public.customers VALUES (
  '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', NULL
);
INSERT INTO public.customer_savings_goals(id, merchant_id, customer_id) VALUES (
  '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001'
);
INSERT INTO piggyvest_staging.integrations VALUES (
  '40000000-0000-4000-8000-000000000001', 'synthetic-account', true
);
