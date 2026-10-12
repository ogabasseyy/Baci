CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE ROLE ledger_caller LOGIN;
CREATE TABLE public.merchants (id uuid PRIMARY KEY);
CREATE TABLE public.customers (id uuid PRIMARY KEY, merchant_id uuid NOT NULL REFERENCES public.merchants);
CREATE TABLE public.customer_savings_goals (
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL REFERENCES public.merchants,
  customer_id uuid NOT NULL REFERENCES public.customers
);
CREATE SCHEMA piggyvest_staging;
CREATE TABLE piggyvest_staging.integrations (
  id uuid PRIMARY KEY,
  expected_provider_account_id text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.merchants VALUES ('10000000-0000-4000-8000-000000000001');
INSERT INTO public.customers VALUES ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001');
INSERT INTO public.customer_savings_goals VALUES ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001');
INSERT INTO piggyvest_staging.integrations VALUES ('40000000-0000-4000-8000-000000000001', 'synthetic-account', true);
