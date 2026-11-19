DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
-- Minimal disposable schema; money functions are replayed from real migrations.
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
GRANT USAGE ON SCHEMA auth,extensions TO authenticated,anon,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon,service_role;
CREATE TABLE public.merchants(id uuid PRIMARY KEY);
CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid REFERENCES public.merchants(id),user_id uuid);
CREATE TABLE public.customer_wallets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 customer_id uuid,merchant_id uuid,available_balance numeric,total_redeemed numeric DEFAULT 0,updated_at timestamptz);
CREATE TABLE public.customer_wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 wallet_id uuid,customer_id uuid,merchant_id uuid,type text,status text,amount numeric,
 balance_after numeric,source_type text,source_id uuid,description text,created_at timestamptz DEFAULT now());
INSERT INTO public.merchants VALUES('10000000-0000-4000-8000-000000000001');
INSERT INTO public.customers VALUES('30000000-0000-4000-8000-000000000001',
 '10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');
INSERT INTO public.customer_wallets(customer_id,merchant_id,available_balance)
 VALUES('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',1000);
ALTER TABLE public.customer_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_wallet ON public.customer_wallets FOR SELECT TO authenticated USING(
 EXISTS(SELECT 1 FROM public.customers c WHERE c.id=customer_id AND c.user_id=auth.uid()));
GRANT SELECT ON public.customer_wallets,public.customers TO authenticated;
