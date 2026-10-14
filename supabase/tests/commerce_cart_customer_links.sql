-- Disposable local PostgreSQL only. No live customers, orders or providers.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOLOGIN NOINHERIT; END IF; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(auth.jwt()->>'sub','')::uuid $$;
CREATE TABLE public.merchants(id uuid PRIMARY KEY,premium_features jsonb,slug text DEFAULT 'shop');
CREATE TABLE public.products(id uuid PRIMARY KEY,merchant_id uuid NOT NULL,price numeric(10,2) NOT NULL,status text NOT NULL,stock_quantity integer DEFAULT 10,stock integer DEFAULT 10,manage_stock boolean DEFAULT true);
CREATE TABLE public.product_variants(id uuid PRIMARY KEY,product_id uuid,merchant_id uuid,price_override numeric(10,2));
CREATE TABLE public.customers(id uuid PRIMARY KEY,merchant_id uuid NOT NULL,user_id uuid NOT NULL,email text);
INSERT INTO public.merchants(id,premium_features) VALUES ('11111111-1111-4111-8111-111111111111','["shared_cart","shared_cart_accounts"]'),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','["shared_cart","shared_cart_accounts"]');
INSERT INTO public.customers VALUES
('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','same@example.test'),
('33333333-3333-4333-8333-333333333334','11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444445','same@example.test'),
('33333333-3333-4333-8333-333333333335','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444','same@example.test');
\ir ../migrations/20261012050000_commerce_cart_core.sql
\ir ../migrations/20261012050100_commerce_cart_roles.sql
\ir ../migrations/20261012050200_commerce_cart_commands.sql
\ir ../migrations/20261012050400_commerce_cart_create_grant.sql
\ir ../migrations/20261012050500_commerce_cart_handoff.sql
\ir ../migrations/20261014120000_commerce_cart_account_continuity.sql
\ir ../migrations/20261014120100_commerce_cart_mutation_permissions.sql
\ir ../migrations/20261014120400_commerce_cart_handoff_merge_guards.sql
\ir ../migrations/20261014120200_commerce_cart_account_tables.sql
\ir ../migrations/20261014120300_commerce_cart_account_functions.sql
INSERT INTO public.commerce_carts(id,merchant_id,expires_at) VALUES
('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',now()+interval '7 days'),
('22222222-2222-4222-8222-222222222223','11111111-1111-4111-8111-111111111111',now()+interval '7 days');
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at) VALUES
('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222223','device-b',now()+interval '7 days'),
('66666666-6666-4666-8666-666666666667','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','delegated-mcp',now()+interval '7 days');
INSERT INTO public.commerce_cart_customer_carts VALUES ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222',now());
SELECT set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_account_linker','cart_scope','bootstrap','cart_merchant_id','11111111-1111-4111-8111-111111111111','cart_principal_id','device-a','cart_account_user_id','44444444-4444-4444-8444-444444444444','cart_customer_id','33333333-3333-4333-8333-333333333333','exp',extract(epoch from now()+interval '5 minutes')::bigint)::text,true);
SET LOCAL ROLE commerce_cart_account_linker;
DO $$ DECLARE result jsonb; BEGIN
result:=public.commerce_cart_account_status();
IF result->>'ok' IS DISTINCT FROM 'true' OR result->'saved'->>'cartId' IS DISTINCT FROM '22222222-2222-4222-8222-222222222222' THEN RAISE EXCEPTION 'owned saved cart inaccessible'; END IF;
result:=public.commerce_cart_link_account('{"operationId":"use-one","choice":"use_saved","expectedSavedCartId":"22222222-2222-4222-8222-222222222222"}');
IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'saved selection failed: %',result; END IF;
IF result->>'cartId' IS DISTINCT FROM '22222222-2222-4222-8222-222222222222' THEN RAISE EXCEPTION 'saved selection finalization failed'; END IF;
IF public.commerce_cart_link_account('{"operationId":"use-one","choice":"use_saved","expectedSavedCartId":"22222222-2222-4222-8222-222222222222"}')->>'replayed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'account response-loss replay failed'; END IF;
IF public.commerce_cart_link_account('{"operationId":"use-one","choice":"keep_current","expectedSavedCartId":"22222222-2222-4222-8222-222222222222"}')->>'code' IS DISTINCT FROM 'idempotency_conflict' THEN RAISE EXCEPTION 'account key/body mismatch accepted'; END IF;
IF has_table_privilege(current_user,'public.customers','SELECT') OR has_table_privilege(current_user,'public.commerce_cart_customer_carts','SELECT') THEN RAISE EXCEPTION 'linker gained raw private table access'; END IF;
END $$;
RESET ROLE;
INSERT INTO public.products(id,merchant_id,price,status) VALUES ('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111',100,'active');
INSERT INTO public.commerce_cart_lines(merchant_id,cart_id,product_id,quantity,negotiated_unit_price_minor,negotiation_status) VALUES
('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','77777777-7777-4777-8777-777777777777',1,9000,'accepted'),
('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222223','77777777-7777-4777-8777-777777777777',1,8000,'accepted');
SELECT set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||'{"cart_scope":"session","cart_principal_id":"device-b","cart_id":"22222222-2222-4222-8222-222222222223","cart_grant_id":"66666666-6666-4666-8666-666666666666"}')::text,true);
SET LOCAL ROLE commerce_cart_account_linker;
DO $$ DECLARE result jsonb; BEGIN
result:=public.commerce_cart_link_account('{"operationId":"merge-omitted","choice":"merge","expectedSavedCartId":"22222222-2222-4222-8222-222222222222","expectedSavedVersion":1,"expectedCurrentVersion":1}','merge-omitted-hash','88888888-8888-4888-8888-888888888886');
IF result->>'code' IS DISTINCT FROM 'invalid_item' THEN RAISE EXCEPTION 'omitted merge plan accepted: %',result; END IF;
result:=public.commerce_cart_link_account('{"operationId":"merge-empty","choice":"merge","expectedSavedCartId":"22222222-2222-4222-8222-222222222222","expectedSavedVersion":1,"expectedCurrentVersion":1,"lines":[]}','merge-empty-hash','88888888-8888-4888-8888-888888888887');
IF result->>'code' IS DISTINCT FROM 'invalid_item' THEN RAISE EXCEPTION 'incomplete empty merge accepted: %',result; END IF;
END $$;
DO $$ DECLARE result jsonb; BEGIN
result:=public.commerce_cart_link_account('{"operationId":"merge-fail","choice":"merge","expectedSavedCartId":"22222222-2222-4222-8222-222222222222","expectedSavedVersion":1,"expectedCurrentVersion":1,"lines":[{"item":{"productId":"77777777-7777-4777-8777-777777777777"},"quantity":1,"negotiatedUnitPriceMinor":8000,"negotiationStatus":"accepted"}]}','merge-fail-hash','88888888-8888-4888-8888-888888888888');
IF result->>'code' IS DISTINCT FROM 'merge_conflict' THEN RAISE EXCEPTION 'expected merge conflict: %',result; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
IF EXISTS(SELECT 1 FROM public.commerce_cart_account_operations WHERE operation_id IN ('merge-fail','merge-omitted','merge-empty')) OR EXISTS(SELECT 1 FROM public.commerce_cart_handoffs WHERE operation_id IN ('account:merge-fail','account:merge-omitted','account:merge-empty')) THEN RAISE EXCEPTION 'failed account merge retained partial state'; END IF;
IF (SELECT linked_customer_id FROM public.commerce_cart_grants WHERE id='66666666-6666-4666-8666-666666666666') IS NOT NULL THEN RAISE EXCEPTION 'failed account merge linked current device'; END IF;
END $$;
SET LOCAL ROLE commerce_cart_account_linker;
DO $$ DECLARE result jsonb; input jsonb:='{"operationId":"merge-ok","choice":"merge","expectedSavedCartId":"22222222-2222-4222-8222-222222222222","expectedSavedVersion":1,"expectedCurrentVersion":1,"lines":[{"item":{"productId":"77777777-7777-4777-8777-777777777777"},"quantity":1,"negotiatedUnitPriceMinor":8000,"negotiationStatus":"accepted"}],"resolutions":[{"item":{"productId":"77777777-7777-4777-8777-777777777777"},"keep":"existing"}]}'; BEGIN
result:=public.commerce_cart_link_account(input,'merge-ok-hash','88888888-8888-4888-8888-888888888889');
IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'resolved merge failed: %',result; END IF;
IF public.commerce_cart_link_account(input,'merge-ok-hash','88888888-8888-4888-8888-888888888889')->>'replayed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'resolved merge replay failed'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
IF (SELECT cart_id FROM public.commerce_cart_customer_carts LIMIT 1) <> '22222222-2222-4222-8222-222222222223' OR (SELECT version FROM public.commerce_carts WHERE id='22222222-2222-4222-8222-222222222223')<>2 THEN RAISE EXCEPTION 'merge/account pointer not atomic or replay duplicated'; END IF;
END $$;
SET LOCAL ROLE commerce_cart_account_linker;
SELECT set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||'{"cart_account_user_id":"44444444-4444-4444-8444-444444444445"}')::text,true);
DO $$ BEGIN IF public.commerce_cart_account_status()->>'code' IS DISTINCT FROM 'unauthorized' THEN RAISE EXCEPTION 'same email different auth subject inherited cart'; END IF; END $$;
SELECT set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||'{"cart_account_user_id":"44444444-4444-4444-8444-444444444444","cart_customer_id":"33333333-3333-4333-8333-333333333335"}')::text,true);
DO $$ BEGIN IF public.commerce_cart_account_status()->>'code' IS DISTINCT FROM 'unauthorized' THEN RAISE EXCEPTION 'cross-merchant customer relation inherited cart'; END IF; END $$;
RESET ROLE;
DO $$ BEGIN IF (SELECT linked_customer_id FROM public.commerce_cart_grants WHERE principal_id='delegated-mcp') IS NOT NULL THEN RAISE EXCEPTION 'delegated grant gained customer relationship'; END IF; END $$;
-- A logout holding the pre-promotion proof must retire the rotated grants too.
SELECT set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_revoker','cart_scope','session','cart_merchant_id','11111111-1111-4111-8111-111111111111','cart_principal_id','device-b','cart_id','22222222-2222-4222-8222-222222222223','cart_grant_id','66666666-6666-4666-8666-666666666666','exp',extract(epoch from now())+300)::text,true);
SET LOCAL ROLE commerce_cart_revoker;
DO $$ BEGIN IF public.commerce_cart_revoke_device_grants()->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'old device proof could not revoke promoted grants'; END IF; END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.commerce_cart_grants WHERE merchant_id='11111111-1111-4111-8111-111111111111' AND coalesce(device_principal_id,principal_id)='device-b' AND revoked_at IS NULL) THEN RAISE EXCEPTION 'rotated device escaped logout'; END IF;
 IF EXISTS(SELECT 1 FROM public.commerce_cart_grants WHERE principal_id='delegated-mcp' AND revoked_at IS NOT NULL) THEN RAISE EXCEPTION 'logout revoked another device'; END IF;
END $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper','cart_scope','bootstrap','cart_merchant_id','11111111-1111-4111-8111-111111111111','cart_principal_id','device-b','exp',extract(epoch from now())+300)::text,true);
SET LOCAL ROLE commerce_cart_shopper;
DO $$ BEGIN IF public.commerce_cart_create('retired-recreate','[]','NGN')->>'code' IS DISTINCT FROM 'unauthorized' THEN RAISE EXCEPTION 'retired device bootstrap recreated authority'; END IF; END $$;
RESET ROLE;
-- keep_current with a saved cart present: an omitted observation links
-- the current cart, while a stale observed saved id still refreshes.
INSERT INTO public.commerce_carts(id,merchant_id,expires_at) VALUES
('22222222-2222-4222-8222-222222222225','11111111-1111-4111-8111-111111111111',now()+interval '7 days');
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,expires_at) VALUES
('66666666-6666-4666-8666-666666666669','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222225','device-z',now()+interval '7 days');
INSERT INTO public.commerce_cart_customer_carts VALUES ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333334','22222222-2222-4222-8222-222222222222',now());
SELECT set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_account_linker','cart_scope','session','cart_merchant_id','11111111-1111-4111-8111-111111111111','cart_principal_id','device-z','cart_id','22222222-2222-4222-8222-222222222225','cart_grant_id','66666666-6666-4666-8666-666666666669','cart_account_user_id','44444444-4444-4444-8444-444444444445','cart_customer_id','33333333-3333-4333-8333-333333333334','exp',extract(epoch from now()+interval '5 minutes')::bigint)::text,true);
SET LOCAL ROLE commerce_cart_account_linker;
DO $$ DECLARE result jsonb; BEGIN
result:=public.commerce_cart_link_account('{"operationId":"keep-stale","choice":"keep_current","expectedSavedCartId":"22222222-2222-4222-8222-222222222299"}');
IF result->>'code' IS DISTINCT FROM 'refresh_required' THEN RAISE EXCEPTION 'stale keep_current observation accepted: %',result; END IF;
result:=public.commerce_cart_link_account('{"operationId":"keep-one","choice":"keep_current"}');
IF result->>'ok' IS DISTINCT FROM 'true' OR result->>'cartId' IS DISTINCT FROM '22222222-2222-4222-8222-222222222225' THEN RAISE EXCEPTION 'keep_current without observed saved id failed: %',result; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
IF (SELECT cart_id FROM public.commerce_cart_customer_carts WHERE customer_id='33333333-3333-4333-8333-333333333334') <> '22222222-2222-4222-8222-222222222225' THEN RAISE EXCEPTION 'keep_current did not link the current cart'; END IF;
END $$;
ROLLBACK;
