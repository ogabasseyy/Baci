-- Empty disposable PostgreSQL only. No application data or external services.
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE authenticator NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb
$$;
CREATE TABLE public.commerce_cart_handoffs(id uuid, merchant_id uuid, handoff_hash text);
INSERT INTO public.commerce_cart_handoffs VALUES(
 '11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222',
 encode(sha256('fixture-pairing-token'::bytea),'hex'));
CREATE FUNCTION public.commerce_cart_handoff_merchant(uuid,text) RETURNS uuid
LANGUAGE sql SECURITY DEFINER AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.commerce_cart_preview_handoff(p_handoff_id uuid,p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 RETURN jsonb_build_object('ok',true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.commerce_cart_preview_handoff(uuid,text) TO anon,authenticated,service_role;
\ir ../migrations/20261015179990_commerce_cart_scoped_preview.sql
\ir ../migrations/20261015179990_commerce_cart_scoped_preview.sql
DO $$
DECLARE r text;
BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF has_function_privilege(r,'public.commerce_cart_preview_handoff(uuid,text)','EXECUTE')
   OR has_function_privilege(r,'public.commerce_cart_handoff_merchant(uuid,text)','EXECUTE') THEN
   RAISE EXCEPTION 'Public RPC bypass for %',r;
  END IF;
 END LOOP;
 IF has_table_privilege('commerce_cart_previewer','public.commerce_cart_handoffs','SELECT') THEN
  RAISE EXCEPTION 'Preview role can read table';
 END IF;
 IF NOT pg_has_role('authenticator','commerce_cart_previewer','MEMBER') THEN
  RAISE EXCEPTION 'Authenticator cannot assume preview role';
 END IF;
END $$;
SET LOCAL ROLE commerce_cart_previewer;
SELECT set_config('request.jwt.claims','{"role":"commerce_cart_previewer","cart_handoff_id":"11111111-1111-4111-8111-111111111111"}',true);
DO $$
BEGIN
 IF public.commerce_cart_handoff_merchant('11111111-1111-4111-8111-111111111111','fixture-pairing-token') IS NULL THEN RAISE EXCEPTION 'Valid locator denied'; END IF;
 IF public.commerce_cart_preview_handoff('11111111-1111-4111-8111-111111111111','fixture-pairing-token')->>'ok' <> 'true' THEN RAISE EXCEPTION 'Valid preview denied'; END IF;
 IF public.commerce_cart_handoff_merchant('11111111-1111-4111-8111-111111111111','wrong') IS NOT NULL THEN RAISE EXCEPTION 'Wrong token accepted'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"role":"commerce_cart_previewer","cart_handoff_id":"33333333-3333-4333-8333-333333333333"}',true);
DO $$
BEGIN
 IF public.commerce_cart_handoff_merchant('11111111-1111-4111-8111-111111111111','fixture-pairing-token') IS NOT NULL THEN RAISE EXCEPTION 'Wrong claim locator accepted'; END IF;
 IF public.commerce_cart_preview_handoff('11111111-1111-4111-8111-111111111111','fixture-pairing-token')->>'ok' <> 'false' THEN RAISE EXCEPTION 'Wrong claim preview accepted'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
