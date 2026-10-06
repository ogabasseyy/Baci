CREATE EXTENSION pgcrypto;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE pvb_staging_app_worker NOLOGIN;
CREATE SCHEMA piggyvest_staging;
CREATE SCHEMA piggyvest_savings_ledger;
CREATE TABLE public.merchants (id uuid PRIMARY KEY, slug text NOT NULL);
CREATE TABLE public.customers (id uuid PRIMARY KEY, merchant_id uuid NOT NULL, user_id uuid NOT NULL, email text NOT NULL);
CREATE TABLE public.customer_savings_goals (id uuid PRIMARY KEY, merchant_id uuid NOT NULL, customer_id uuid NOT NULL, target_amount numeric NOT NULL, current_amount numeric NOT NULL, goal_kind text, source_mode text NOT NULL, status text NOT NULL, completed_at timestamptz, cancelled_at timestamptz, spent_at timestamptz, updated_at timestamptz);
CREATE TABLE public.customer_savings_contributions (id uuid PRIMARY KEY, merchant_id uuid NOT NULL, customer_id uuid NOT NULL, goal_id uuid NOT NULL, amount numeric NOT NULL, status text NOT NULL, processed_at timestamptz, source_type text NOT NULL, idempotency_key text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, CONSTRAINT customer_savings_contributions_source_type_check CHECK (source_type = ANY (ARRAY['wallet','paystack_authorization','manual_adjustment','piggyvest_inflow']::text[])));
CREATE TABLE public.customer_saved_payment_methods (id uuid PRIMARY KEY, merchant_id uuid NOT NULL, customer_id uuid NOT NULL, provider text NOT NULL, provider_customer_email text NOT NULL, authorization_code text NOT NULL, authorization_signature text NOT NULL, authorization_data jsonb NOT NULL DEFAULT '{}'::jsonb, brand text, last4 text, exp_month text, exp_year text, reusable boolean NOT NULL, is_default boolean NOT NULL, is_active boolean NOT NULL, disabled_at timestamptz, UNIQUE (customer_id, provider, authorization_signature));
CREATE TABLE public.transactions (id uuid PRIMARY KEY, merchant_id uuid NOT NULL, gateway text, transaction_type text, status text, currency text, gateway_reference text, metadata jsonb, amount numeric);
CREATE TABLE public.piggyvest_plan_wallets (wallet_id text PRIMARY KEY, piggyvest_customer_id text NOT NULL, customer_id uuid NOT NULL, merchant_id uuid NOT NULL);
CREATE TABLE piggyvest_staging.integrations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  expected_provider_account_id text COLLATE "C" NOT NULL UNIQUE
    CHECK (pg_catalog.octet_length(expected_provider_account_id) BETWEEN 1 AND 512),
  enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE piggyvest_staging.wallet_goal_mappings (integration_id uuid NOT NULL, merchant_id uuid NOT NULL, customer_id uuid NOT NULL, goal_id uuid NOT NULL, provider_wallet_id text NOT NULL, provider_customer_id text NOT NULL, UNIQUE (integration_id, merchant_id, customer_id, goal_id));
CREATE TABLE piggyvest_savings_ledger.bindings (integration_id uuid NOT NULL, merchant_id uuid NOT NULL, customer_id uuid NOT NULL, goal_id uuid NOT NULL, enabled boolean NOT NULL, authorized_login name NOT NULL, UNIQUE (integration_id, merchant_id, customer_id, goal_id));
CREATE TABLE piggyvest_savings_ledger.operations (id uuid PRIMARY KEY, integration_id uuid NOT NULL, goal_id uuid NOT NULL);
CREATE TABLE piggyvest_savings_ledger.postings (operation_id uuid NOT NULL, account text NOT NULL, amount_kobo bigint NOT NULL);
CREATE FUNCTION piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION piggyvest_savings_ledger.snapshot(uuid,uuid,uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.recognize_piggyvest_staging_inflow(text,text,text,text,text,bigint,bigint,text,text,timestamp with time zone) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
