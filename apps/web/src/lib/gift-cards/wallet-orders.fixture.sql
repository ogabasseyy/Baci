-- Minimal synthetic schema for a disposable PostgreSQL database only.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE SCHEMA extensions;
CREATE SCHEMA vault;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE vault.decrypted_secrets(name text NOT NULL, decrypted_secret text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
CREATE TABLE public.merchants(id uuid PRIMARY KEY,slug text NOT NULL);
CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid NOT NULL,user_id uuid NOT NULL);
CREATE TABLE public.customer_wallets(id uuid PRIMARY KEY,customer_id uuid NOT NULL,merchant_id uuid NOT NULL,available_balance numeric(12,2),total_redeemed numeric(12,2),updated_at timestamptz);
CREATE TABLE public.customer_wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),wallet_id uuid NOT NULL,customer_id uuid NOT NULL,merchant_id uuid NOT NULL,type text,amount numeric(10,2),balance_after numeric(12,2),source_type text,source_id uuid,status text,description text);
