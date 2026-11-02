\set ON_ERROR_STOP on
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE TABLE public.merchants (
  id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users, email text,
  business_name text, slug text
);
CREATE TABLE public.customers (
  id uuid PRIMARY KEY, merchant_id uuid REFERENCES public.merchants,
  user_id uuid REFERENCES auth.users, email text, first_name text,
  last_name text, phone text, deleted_at timestamptz, loyalty_points integer DEFAULT 0,
  username text, username_changed_at timestamptz, date_of_birth date
);
ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_customer ON public.customers TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
GRANT SELECT, UPDATE ON public.customers TO authenticated;
\ir ../../../../../supabase/migrations/20261017084453_storefront_wallet_phone_update.sql
\ir ../../../../../supabase/tests/storefront_wallet_phone_update.sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.customers)
    OR EXISTS (SELECT 1 FROM public.merchants)
    OR EXISTS (SELECT 1 FROM auth.users) THEN
    RAISE EXCEPTION 'phone-save fixture leaked rows outside its transaction';
  END IF;
END $$;
