-- Run only in an empty disposable PostgreSQL database with psql -v ON_ERROR_STOP=1.
BEGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE authenticator NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
CREATE TABLE public.merchants(id uuid PRIMARY KEY,slug text,business_name text);
CREATE TABLE public.domains(id uuid,merchant_id uuid,domain text,is_primary boolean,status text,updated_at timestamptz,created_at timestamptz);
CREATE TABLE public.merchant_feature_settings(merchant_id uuid,agentic_checkout_enabled boolean,pay_on_delivery_enabled boolean,custom_settings jsonb);
INSERT INTO public.merchants VALUES('11111111-1111-4111-8111-111111111111','ogabassey','Ogabassey'),('22222222-2222-4222-8222-222222222222','other','Other');
INSERT INTO public.merchant_feature_settings VALUES('11111111-1111-4111-8111-111111111111',false,true,'{"agentic_agent_allowlist":["trusted"],"agentic_agent_denylist":["blocked"],"private_secret":"never-return"}');
\ir ../migrations/20261015179995_agentic_merchant_context_authority.sql
\ir ../migrations/20261015179995_agentic_merchant_context_authority.sql
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF has_function_privilege(r,'public.resolve_agentic_merchant_context(text)','EXECUTE') THEN RAISE EXCEPTION 'Private oracle executable by %',r; END IF;
 END LOOP;
 IF has_table_privilege('agentic_merchant_context','public.merchant_feature_settings','SELECT') THEN RAISE EXCEPTION 'Direct private table access'; END IF;
 IF NOT pg_has_role('authenticator','agentic_merchant_context','MEMBER') THEN RAISE EXCEPTION 'Missing authenticator membership'; END IF;
END $$;
SET LOCAL ROLE agentic_merchant_context;
SELECT set_config('request.jwt.claims','{"role":"agentic_merchant_context","agentic_merchant_slug":"ogabassey"}',true);
DO $$ DECLARE r record; BEGIN
 SELECT * INTO r FROM public.resolve_agentic_merchant_context(' Ogabassey ');
 IF r.id IS NULL OR r.agent_allowlist <> '["trusted"]'::jsonb OR r.agentic_checkout_enabled <> false THEN RAISE EXCEPTION 'Bound lookup failed'; END IF;
 IF r.paystack_subaccount_code IS NOT NULL THEN RAISE EXCEPTION 'Payment identifier disclosed'; END IF;
 IF EXISTS(SELECT 1 FROM public.resolve_agentic_merchant_context('other')) THEN RAISE EXCEPTION 'Cross slug lookup allowed'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"role":"authenticated","agentic_merchant_slug":"ogabassey"}',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.resolve_agentic_merchant_context('ogabassey')) THEN RAISE EXCEPTION 'Wrong JWT role accepted'; END IF; END $$;
RESET ROLE;
ROLLBACK;
