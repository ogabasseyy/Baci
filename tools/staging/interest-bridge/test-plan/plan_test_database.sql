CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE ROLE prefunded_treasury_operator LOGIN NOINHERIT VALID UNTIL '2026-10-06T15:59:10Z';
CREATE ROLE prefunded_treasury_ledger_worker;
CREATE ROLE prefunded_card_authorization_reader;
CREATE ROLE supabase_admin SUPERUSER;
GRANT prefunded_treasury_ledger_worker,prefunded_card_authorization_reader TO supabase_admin WITH ADMIN TRUE;
SET ROLE supabase_admin;
GRANT prefunded_treasury_ledger_worker,prefunded_card_authorization_reader TO prefunded_treasury_operator
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY supabase_admin;
RESET ROLE;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY, deleted_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$
  SELECT nullif(current_setting('request.jwt.claim.role',true),'');
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE public.merchants(id uuid PRIMARY KEY,is_published boolean DEFAULT false);
CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid REFERENCES public.merchants,
  user_id uuid REFERENCES auth.users,deleted_at timestamptz);
CREATE TABLE public.products(id uuid PRIMARY KEY,merchant_id uuid REFERENCES public.merchants,
  name text,price numeric,status text,condition text,images jsonb);
CREATE TABLE public.product_variants(id uuid PRIMARY KEY,product_id uuid REFERENCES public.products,
  merchant_id uuid REFERENCES public.merchants,condition text,sku text,price_override numeric,
  primary_image text,images jsonb,attributes jsonb,is_inventory_anchor boolean);
CREATE TABLE public.customer_saved_payment_methods(id uuid PRIMARY KEY,merchant_id uuid,customer_id uuid,
  provider text,status text);
CREATE TABLE public.orders(id uuid PRIMARY KEY);
CREATE TABLE public.transactions(id uuid PRIMARY KEY,gateway text,gateway_reference text,metadata jsonb);
CREATE TABLE public.customer_wallet_transactions(id uuid PRIMARY KEY);
CREATE TABLE public.customer_wallets(customer_id uuid,merchant_id uuid,available_balance numeric);
CREATE TABLE public.merchant_feature_settings(merchant_id uuid PRIMARY KEY,paystack_enabled boolean);
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN NEW.updated_at:=clock_timestamp(); RETURN NEW; END;
$$;
CREATE SCHEMA piggyvest_staging;
CREATE TABLE piggyvest_staging.integrations(id uuid PRIMARY KEY,expected_provider_account_id text UNIQUE,enabled boolean);
CREATE SCHEMA savings_draft_private;
CREATE TABLE public.customer_savings_drafts(id uuid,revision_id uuid,product_id uuid,variant_id uuid,
  catalogue jsonb,terms_version text,terms_hash text,accepted_at timestamptz);
CREATE SCHEMA prefunded_card;
CREATE TABLE prefunded_card.treasury_bindings(id uuid PRIMARY KEY,verified_available_kobo bigint,
  reserved_kobo bigint,consumed_kobo bigint,enabled boolean);
CREATE TABLE prefunded_card.treasury_identities(treasury_binding_id uuid PRIMARY KEY,
  integration_id uuid,merchant_id uuid,expected_business_id text,source_wallet_id text,
  authorized_login name,opening_available_kobo bigint);
CREATE TABLE prefunded_card.treasury_replenishments(id uuid PRIMARY KEY,
  treasury_binding_id uuid,amount_kobo bigint);
CREATE TABLE prefunded_card.operations(id uuid PRIMARY KEY);
CREATE SCHEMA savings_notifications;
CREATE TABLE savings_notifications.outbox(id uuid PRIMARY KEY);
