-- Disposable local PostgreSQL only; stub command executor, no orders/providers.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOLOGIN; END IF; END $$;
CREATE TABLE public.merchants(id uuid PRIMARY KEY, premium_features jsonb NOT NULL DEFAULT '[]'::jsonb);
INSERT INTO public.merchants VALUES('11111111-1111-4111-8111-111111111111', '["shared_cart","shared_cart_accounts","shared_cart_realtime"]'::jsonb);
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb $$;
\ir ../migrations/20261012050000_commerce_cart_core.sql
\ir ../migrations/20261012050100_commerce_cart_roles.sql
CREATE TABLE public.products (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL,
  price numeric(10,2) NOT NULL,
  status text NOT NULL,
  stock_quantity integer NOT NULL DEFAULT 0,
  stock integer NOT NULL DEFAULT 0,
  manage_stock boolean NOT NULL DEFAULT true,
  has_variants boolean NOT NULL DEFAULT false
);
CREATE TABLE public.product_variants (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  price_override numeric(10,2) NULL,
  stock_quantity integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active',
  deleted_at timestamptz NULL,
  archived_at timestamptz NULL,
  is_default boolean NOT NULL DEFAULT false
);
\ir ../migrations/20261012050200_commerce_cart_commands.sql
CREATE OR REPLACE FUNCTION public.commerce_cart_create(p_operation_id text, p_lines jsonb, p_currency text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"ok":true}'::jsonb $$;
\ir ../migrations/20261014120000_commerce_cart_account_continuity.sql
CREATE OR REPLACE FUNCTION public.commerce_cart_mutate(p_cart_id uuid, p_operation_id text, p_expected_version integer, p_command jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT jsonb_build_object('ok',true) $$;
GRANT EXECUTE ON FUNCTION public.commerce_cart_mutate(uuid,text,integer,jsonb) TO commerce_cart_shopper;
\ir ../migrations/20261014120100_commerce_cart_mutation_permissions.sql
\ir ../migrations/20261015090000_commerce_cart_negotiation_policy.sql
\ir ../migrations/20261015100000_commerce_cart_mutation_permissions_restore.sql
INSERT INTO public.commerce_carts(id,merchant_id,expires_at) VALUES ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',now()+interval '7 days');
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,allowed_operations,expires_at) VALUES ('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','restricted-device',ARRAY['remove'],now()+interval '7 days');
SET LOCAL ROLE commerce_cart_shopper;
SELECT set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper','cart_scope','session','cart_merchant_id','11111111-1111-4111-8111-111111111111','cart_id','22222222-2222-4222-8222-222222222222','cart_grant_id','66666666-6666-4666-8666-666666666666','cart_principal_id','restricted-device','exp',extract(epoch from now()+interval '5 minutes')::bigint)::text,true);
DO $$ BEGIN
IF public.commerce_cart_mutate('22222222-2222-4222-8222-222222222222','denied',1,'{"type":"clear"}')->>'code' IS DISTINCT FROM 'unauthorized' THEN RAISE EXCEPTION 'restricted grant accepted clear'; END IF;
-- The wrapper must let an allowed operation through to the executor;
-- the executor's own result for a missing line is the commands suite's
-- concern, so assert only that the gate did not deny it.
IF public.commerce_cart_mutate('22222222-2222-4222-8222-222222222222','allowed',1,'{"type":"remove"}')->>'code' IS NOT DISTINCT FROM 'unauthorized' THEN RAISE EXCEPTION 'allowed removal rejected by the wrapper'; END IF;
IF has_function_privilege(current_user,'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'shopper bypasses permission wrapper'; END IF;
END $$;
RESET ROLE;
UPDATE public.commerce_cart_grants SET allowed_operations='{}';
SET LOCAL ROLE commerce_cart_shopper;
DO $$ BEGIN IF public.commerce_cart_mutate('22222222-2222-4222-8222-222222222222','empty',1,'{"type":"remove"}')->>'code' IS DISTINCT FROM 'unauthorized' THEN RAISE EXCEPTION 'empty grant accepted mutation'; END IF; END $$;
RESET ROLE;
DO $$ BEGIN
IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='commerce_cart_grants' AND column_name='allowed_operations') NOT LIKE '%replace%' THEN RAISE EXCEPTION 'new standard grants omit replacement'; END IF;
IF (SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='commerce_cart_grants' AND column_name='allowed_operations') NOT LIKE '%set_negotiated_price%' THEN RAISE EXCEPTION 'new standard grants omit negotiated repricing'; END IF;
IF (SELECT allowed_operations FROM public.commerce_cart_grants LIMIT 1) <> '{}' THEN RAISE EXCEPTION 'migration escalated existing restricted grant'; END IF;
END $$;
-- End of chain: after the negotiation-policy and wrapper-restore
-- migrations, the public entry point still enforces restricted grants
-- and device retirement, and the executor stays private.
UPDATE public.commerce_cart_grants SET allowed_operations=ARRAY['remove'];
SET LOCAL ROLE commerce_cart_shopper;
DO $$ BEGIN
IF public.commerce_cart_mutate('22222222-2222-4222-8222-222222222222','eoc-denied',1,'{"type":"clear"}')->>'code' IS DISTINCT FROM 'unauthorized' THEN RAISE EXCEPTION 'end-of-chain restricted grant accepted clear'; END IF;
IF public.commerce_cart_mutate('22222222-2222-4222-8222-222222222222','eoc-allowed',1,'{"type":"remove","lineId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}')->>'code' IS NOT DISTINCT FROM 'unauthorized' THEN RAISE EXCEPTION 'end-of-chain allowed removal blocked by the wrapper'; END IF;
IF has_function_privilege(current_user,'public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'shopper bypasses permission wrapper at end of chain'; END IF;
END $$;
RESET ROLE;
INSERT INTO public.commerce_cart_device_retirements(merchant_id, device_principal_id) VALUES ('11111111-1111-4111-8111-111111111111','restricted-device');
SET LOCAL ROLE commerce_cart_shopper;
DO $$ BEGIN IF public.commerce_cart_mutate('22222222-2222-4222-8222-222222222222','eoc-retired',1,'{"type":"remove","lineId":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}')->>'code' IS DISTINCT FROM 'unauthorized' THEN RAISE EXCEPTION 'retired device accepted mutation at end of chain'; END IF; END $$;
RESET ROLE;
ROLLBACK;
