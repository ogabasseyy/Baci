CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE pvb_staging_app_worker NOLOGIN;
CREATE SCHEMA piggyvest_staging;

CREATE TABLE public.merchants (id uuid PRIMARY KEY);
CREATE TABLE public.customers (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id)
);
CREATE TABLE public.customer_wallet_transactions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id)
);
CREATE TABLE public.customer_savings_goals (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  goal_kind text NOT NULL,
  source_mode text NOT NULL,
  current_amount numeric(12,2) NOT NULL,
  target_amount numeric(12,2) NOT NULL,
  status text NOT NULL,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE TABLE public.customer_savings_contributions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.customer_savings_goals(id),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  wallet_transaction_id uuid REFERENCES public.customer_wallet_transactions(id),
  transaction_id uuid,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  source_type text NOT NULL CHECK (source_type = ANY (ARRAY[
    'wallet', 'paystack_authorization', 'manual_adjustment'
  ]::text[])),
  status text NOT NULL CHECK (status = ANY (ARRAY[
    'pending', 'processing', 'completed', 'failed', 'cancelled'
  ]::text[])),
  processed_at timestamptz,
  idempotency_key text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (merchant_id, idempotency_key)
);
CREATE TABLE public.piggyvest_inflow_credits (
  provider_transaction_id text PRIMARY KEY,
  event_data_id text NOT NULL,
  event_id text NOT NULL,
  customer_id text NOT NULL,
  wallet_id text NOT NULL,
  amount_kobo bigint NOT NULL,
  fee_kobo bigint NOT NULL,
  reference text NOT NULL,
  session_id text NOT NULL,
  credited_at timestamptz NOT NULL
);
CREATE TABLE public.piggyvest_plan_wallets (
  customer_id text NOT NULL,
  merchant_id text NOT NULL,
  piggyvest_customer_id text NOT NULL,
  wallet_id text PRIMARY KEY
);
CREATE TABLE piggyvest_staging.integrations (
  id uuid PRIMARY KEY,
  enabled boolean NOT NULL
);
CREATE TABLE piggyvest_staging.wallet_goal_mappings (
  integration_id uuid NOT NULL REFERENCES piggyvest_staging.integrations(id),
  provider_wallet_id text NOT NULL,
  provider_customer_id text NOT NULL,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  goal_id uuid NOT NULL UNIQUE REFERENCES public.customer_savings_goals(id),
  PRIMARY KEY (integration_id, provider_wallet_id)
);

INSERT INTO public.merchants (id)
VALUES ('11111111-1111-4111-8111-111111111111');
INSERT INTO public.customers (id, merchant_id)
VALUES ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111');
INSERT INTO public.customer_savings_goals (
  id, merchant_id, customer_id, goal_kind, source_mode,
  current_amount, target_amount, status
) VALUES (
  '33333333-3333-4333-8333-333333333333',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'legacy', 'manual', 0, 2500, 'active'
);
INSERT INTO piggyvest_staging.integrations (id, enabled)
VALUES ('d91d9e87-8e0d-44de-9b84-1e1d709633d2', true);
INSERT INTO piggyvest_staging.wallet_goal_mappings (
  integration_id, provider_wallet_id, provider_customer_id,
  merchant_id, customer_id, goal_id
) VALUES (
  'd91d9e87-8e0d-44de-9b84-1e1d709633d2', 'scratch-private-wallet',
  'scratch-event-customer', '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'
);
INSERT INTO public.piggyvest_plan_wallets (
  customer_id, merchant_id, piggyvest_customer_id, wallet_id
) VALUES ('legacy-local-customer', 'legacy-local-merchant', 'scratch-api-customer', 'scratch-public-wallet');
