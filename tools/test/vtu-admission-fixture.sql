-- Owned native PG fixture only; canonical replay supplies the real schema.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '')
$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY, instance_id uuid, aud text, role text, email text,
  encrypted_password text, email_confirmed_at timestamptz,
  phone_confirmed_at timestamptz, created_at timestamptz, updated_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb
);
CREATE TABLE public.merchants (id uuid PRIMARY KEY, email text, business_name text, slug text);
CREATE TABLE public.merchant_slug_aliases (merchant_id uuid, old_slug text);
CREATE TABLE public.customers (id uuid PRIMARY KEY, merchant_id uuid, email text, user_id uuid);
CREATE TABLE public.vtu_transactions (
  id uuid PRIMARY KEY, merchant_id uuid, customer_id uuid, type text,
  network_provider text, phone_number text, amount numeric,
  request_reference text, status text, source text, metadata jsonb,
  terminal_at timestamptz
);
CREATE TABLE public.vtu_idempotency_keys (
  key uuid PRIMARY KEY, vtu_transaction_id uuid, customer_id uuid,
  merchant_id uuid, request_fingerprint text, created_at timestamptz DEFAULT now()
);
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
