-- Disposable PostgreSQL only. No provider calls or live orders.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOLOGIN; END IF; END $$;
CREATE TABLE public.merchants(id uuid PRIMARY KEY);
INSERT INTO public.merchants VALUES('11111111-1111-4111-8111-111111111111'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
\ir ../migrations/20261012050000_commerce_cart_core.sql
\ir ../migrations/20261012050100_commerce_cart_roles.sql
CREATE FUNCTION public.commerce_cart_create(text,jsonb,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"ok":true}'::jsonb $$;
\ir ../migrations/20261014120000_commerce_cart_account_continuity.sql
INSERT INTO public.commerce_carts(id,merchant_id,expires_at) VALUES
('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',now()+interval '7 days'),
('22222222-2222-4222-8222-222222222223','11111111-1111-4111-8111-111111111111',now()+interval '7 days'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',now()+interval '7 days');
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at) VALUES
('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','device-a',now()+interval '7 days'),
('66666666-6666-4666-8666-666666666667','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222223','device-a',now()+interval '7 days'),
('66666666-6666-4666-8666-666666666668','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','other-device',now()+interval '7 days'),
('66666666-6666-4666-8666-666666666669','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','device-a',now()+interval '7 days');
SET LOCAL ROLE commerce_cart_shopper;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper','cart_scope','session','cart_merchant_id','11111111-1111-4111-8111-111111111111','cart_id','22222222-2222-4222-8222-222222222222','cart_grant_id','66666666-6666-4666-8666-666666666666','cart_principal_id','device-a','exp',extract(epoch from now()+interval '5 minutes')::bigint)::text,true);
DO $$ BEGIN
IF public.commerce_cart_revoke_device_grants()->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'own device revocation failed'; END IF;
IF public.commerce_cart_revoke_device_grants()->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'revocation replay failed'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
IF (SELECT count(*) FROM public.commerce_cart_grants WHERE revoked_at IS NOT NULL) <> 2 THEN RAISE EXCEPTION 'revoked foreign device/merchant or missed owned grant'; END IF;
IF (SELECT count(*) FROM public.commerce_carts WHERE state='active') <> 3 THEN RAISE EXCEPTION 'logout changed cart state'; END IF;
END $$;
ROLLBACK;
