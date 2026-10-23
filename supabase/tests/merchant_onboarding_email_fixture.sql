-- Disposable Postgres fixture ONLY; never execute against a project database.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
CREATE TABLE public.merchants(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),business_name text,is_published boolean,slug text,country text,payout_currency text,support_email text,support_phone text,email text,phone text,bank_code text,bank_account_number text,paystack_subaccount_code text);
CREATE TABLE public.page_configs(merchant_id uuid,page_slug text);
CREATE TABLE public.domains(merchant_id uuid);
CREATE TABLE public.merchant_feature_settings(merchant_id uuid,paystack_enabled boolean,korapay_enabled boolean,pay_on_delivery_enabled boolean);
CREATE TABLE public.merchant_verifications(merchant_id uuid,nin_verified boolean,bvn_verified boolean,cac_verified boolean);
CREATE TABLE public.products(merchant_id uuid,status text);
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
INSERT INTO auth.users VALUES('10000000-0000-4000-8000-000000000001','owner@example.com',now(),NULL,NULL);
INSERT INTO public.merchants(id,user_id,business_name) VALUES('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Historical store');
CREATE FUNCTION public.trigger_welcome_email() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
CREATE TRIGGER on_email_confirmed AFTER UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.trigger_welcome_email();
