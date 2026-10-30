-- Run only in an empty disposable PostgreSQL database with psql -v ON_ERROR_STOP=1.
BEGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE authenticator NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
CREATE TABLE public.merchants(id uuid PRIMARY KEY,slug text,business_name text,paystack_subaccount_code text);
CREATE TABLE public.domains(id uuid,merchant_id uuid,domain text,is_primary boolean,status text,updated_at timestamptz,created_at timestamptz);
CREATE TABLE public.merchant_feature_settings(merchant_id uuid,agentic_checkout_enabled boolean,pay_on_delivery_enabled boolean,custom_settings jsonb);
INSERT INTO public.merchants VALUES('11111111-1111-4111-8111-111111111111','ogabassey','Ogabassey','ACCT_ogabassey'),('22222222-2222-4222-8222-222222222222','other','Other','ACCT_other');
\ir ../migrations/20261015179995_agentic_merchant_context_authority.sql
\ir ../migrations/20261030190000_agentic_merchant_payment_split.sql
\ir ../migrations/20261030190000_agentic_merchant_payment_split.sql
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF has_function_privilege(r,'public.resolve_agentic_merchant_payment_split(text)','EXECUTE') THEN RAISE EXCEPTION 'Payment split executable by %',r; END IF;
 END LOOP;
 IF NOT has_function_privilege('agentic_merchant_context','public.resolve_agentic_merchant_payment_split(text)','EXECUTE') THEN RAISE EXCEPTION 'Context role cannot read the payment split'; END IF;
 IF has_table_privilege('agentic_merchant_context','public.merchants','SELECT') THEN RAISE EXCEPTION 'Direct merchants access'; END IF;
END $$;
SET LOCAL ROLE agentic_merchant_context;
SELECT set_config('request.jwt.claims','{"role":"agentic_merchant_context","agentic_merchant_slug":"ogabassey"}',true);
DO $$ DECLARE r record; BEGIN
 SELECT * INTO r FROM public.resolve_agentic_merchant_payment_split(' Ogabassey ');
 IF r.paystack_subaccount_code IS DISTINCT FROM 'ACCT_ogabassey' THEN RAISE EXCEPTION 'Bound payment split lookup failed'; END IF;
 IF EXISTS(SELECT 1 FROM public.resolve_agentic_merchant_payment_split('other')) THEN RAISE EXCEPTION 'Cross slug payment split allowed'; END IF;
 SELECT * INTO r FROM public.resolve_agentic_merchant_context('ogabassey');
 IF r.paystack_subaccount_code IS NOT NULL THEN RAISE EXCEPTION 'Context projection discloses the payment identifier'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"role":"authenticated","agentic_merchant_slug":"ogabassey"}',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.resolve_agentic_merchant_payment_split('ogabassey')) THEN RAISE EXCEPTION 'Wrong JWT role accepted'; END IF; END $$;
RESET ROLE;
ROLLBACK;
