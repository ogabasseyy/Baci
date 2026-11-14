-- Disposable focused contract test. Run only through run_chatwoot_cart_add_receipts.py.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE ROLE commerce_cart_shopper;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE SCHEMA discovery;
CREATE FUNCTION discovery.canonical_product_condition(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE normalized WHEN 'uk_used' THEN 'used' WHEN 'refurbished' THEN 'open_box'
    WHEN 'new' THEN 'new' WHEN 'used' THEN 'used' WHEN 'open_box' THEN 'open_box' ELSE NULL END
  FROM (SELECT lower(regexp_replace(regexp_replace(value, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '[[:space:]-]+', '_', 'g')) AS normalized) s
$$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb
$$;

CREATE TABLE public.merchants(id uuid PRIMARY KEY, premium_features jsonb NOT NULL);
CREATE TABLE public.commerce_carts(
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL, version integer NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'active', expires_at timestamptz NOT NULL DEFAULT now() + interval '1 day'
);
CREATE TABLE public.commerce_cart_grants(
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL, cart_id uuid NOT NULL, principal_id text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '1 day', revoked_at timestamptz,
  allowed_operations text[] NOT NULL DEFAULT ARRAY['add']::text[]
);
CREATE TABLE public.commerce_cart_operations(
  merchant_id uuid NOT NULL, cart_id uuid NOT NULL, principal_id text NOT NULL, operation_id text NOT NULL,
  request_digest text NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now() + interval '1 day',
  PRIMARY KEY(merchant_id, cart_id, principal_id, operation_id)
);
CREATE TABLE public.products(
  id uuid PRIMARY KEY, merchant_id uuid NOT NULL, slug text NOT NULL, status text NOT NULL DEFAULT 'active',
  has_variants boolean NOT NULL DEFAULT false, has_condition_offers boolean NOT NULL DEFAULT false,
  manage_stock boolean, stock numeric, stock_quantity numeric, condition text, default_variant_id uuid,
  effective_policy text NOT NULL DEFAULT 'off'
);
CREATE TABLE public.product_variants(
  id uuid PRIMARY KEY, product_id uuid NOT NULL, merchant_id uuid NOT NULL, status text NOT NULL DEFAULT 'active',
  is_active boolean DEFAULT true, deleted_at timestamptz, archived_at timestamptz, is_inventory_anchor boolean DEFAULT false,
  attributes jsonb DEFAULT '{}'::jsonb, condition text,
  effective_policy text NOT NULL DEFAULT 'off', stock_quantity numeric, available_units numeric
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products, public.product_variants, public.commerce_cart_operations, public.commerce_carts TO commerce_cart_shopper;
CREATE FUNCTION public.commerce_cart_device_is_active() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION private.get_storefront_pdp_core_v2(uuid, text, uuid)
RETURNS TABLE(resolution_status text, product_data jsonb) LANGUAGE sql STABLE AS $$
  SELECT 'found', jsonb_build_object(
    'id', p.id, 'merchant_id', p.merchant_id, 'slug', p.slug, 'status', p.status,
    'has_variants', p.has_variants, 'has_condition_offers', CASE WHEN p.slug='malformed-condition' THEN 'not-a-boolean' ELSE p.has_condition_offers::text END,
    'manage_stock', p.manage_stock, 'stock', p.stock, 'stock_quantity', p.stock_quantity,
    'condition', p.condition, 'default_variant_id', p.default_variant_id, 'effective_policy', p.effective_policy,
    'product_variants', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', v.id, 'product_id', v.product_id, 'effective_policy', v.effective_policy,
      'stock_quantity', v.stock_quantity, 'available_units', v.available_units, 'attributes', v.attributes, 'condition', v.condition
    )) FROM public.product_variants v WHERE v.product_id=p.id AND v.merchant_id=p.merchant_id), '[]'::jsonb)
  ) FROM public.products p
  WHERE p.merchant_id=$1 AND p.status='active' AND lower(p.slug)=lower(trim($2))
  LIMIT 1
$$;
CREATE FUNCTION public.commerce_cart_mutate(uuid, text, integer, jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.commerce_carts%ROWTYPE; existing public.commerce_cart_operations%ROWTYPE; digest text;
BEGIN
  SELECT * INTO c FROM public.commerce_carts WHERE id=$1 FOR UPDATE;
  digest := md5($4::text);
  SELECT * INTO existing FROM public.commerce_cart_operations WHERE merchant_id=c.merchant_id AND cart_id=$1 AND principal_id=auth.jwt()->>'cart_principal_id' AND operation_id=$2;
  IF FOUND THEN
    IF existing.request_digest <> digest THEN RETURN jsonb_build_object('ok',false,'code','idempotency_conflict','state',null,'currentVersion',c.version,'replayed',false); END IF;
    RETURN jsonb_build_object('ok',true,'code',null,'state',existing.result,'currentVersion',c.version,'replayed',true);
  END IF;
  IF c.version <> $3 THEN RETURN jsonb_build_object('ok',false,'code','version_conflict','state',null,'currentVersion',c.version,'replayed',false); END IF;
  IF $4->>'type' <> 'add' OR $4->>'quantity' <> '1' THEN RAISE EXCEPTION 'unexpected command'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id=($4#>>'{item,productId}')::uuid AND p.merchant_id=c.merchant_id AND p.status='active') THEN RAISE EXCEPTION 'invalid_offer'; END IF;
  UPDATE public.commerce_carts SET version=version+1 WHERE id=$1 RETURNING * INTO c;
  INSERT INTO public.commerce_cart_operations(merchant_id,cart_id,principal_id,operation_id,request_digest,result)
  VALUES(c.merchant_id,$1,auth.jwt()->>'cart_principal_id',$2,digest,jsonb_build_object('version',c.version));
  RETURN jsonb_build_object('ok',true,'code',null,'state',jsonb_build_object('version',c.version),'currentVersion',c.version,'replayed',false);
END $$;
GRANT EXECUTE ON FUNCTION public.commerce_cart_mutate(uuid,text,integer,jsonb) TO commerce_cart_shopper;

\ir ../migrations/20261114124820_chatwoot_cart_add_receipts.sql

INSERT INTO public.merchants VALUES
  ('11111111-1111-4111-8111-111111111111','["shared_cart"]'),
  ('22222222-2222-4222-8222-222222222222','["shared_cart"]');
INSERT INTO public.commerce_carts(id,merchant_id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222');
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id) VALUES
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','buyer-a'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','buyer-b');
INSERT INTO public.products(id,merchant_id,slug,manage_stock,stock,stock_quantity) VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111','simple',true,2,2),
  ('ffffffff-ffff-4fff-8fff-ffffffffffff','11111111-1111-4111-8111-111111111111','unmanaged',false,0,0),
  ('99999999-9999-4999-8999-999999999999','22222222-2222-4222-8222-222222222222','other',true,3,3),
  ('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','unlimited',true,0,0);
UPDATE public.products SET effective_policy='serialized_then_unlimited' WHERE slug='unlimited';
INSERT INTO public.products(id,merchant_id,slug,manage_stock,stock,stock_quantity) VALUES
  ('14141414-1414-4414-8414-141414141414','11111111-1111-4111-8111-111111111111','malformed-condition',true,2,2),
  ('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','legacy-stock',true,4,0);
INSERT INTO public.products(id,merchant_id,slug,has_variants,manage_stock,stock,stock_quantity) VALUES
  ('88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111','variant',true,true,4,4);
INSERT INTO public.product_variants(id,product_id,merchant_id,effective_policy,stock_quantity,available_units,attributes) VALUES
  ('77777777-7777-4777-8777-777777777777','88888888-8888-4888-8888-888888888888','11111111-1111-4111-8111-111111111111','serialized_strict',5,0,'{"color":"blue"}');
UPDATE public.products SET default_variant_id='77777777-7777-4777-8777-777777777777' WHERE slug='variant';
INSERT INTO public.products(id,merchant_id,slug,has_variants,manage_stock,stock,stock_quantity)
VALUES ('12121212-1212-4212-8212-121212121212','11111111-1111-4111-8111-111111111111','variant-parent-legacy',true,true,4,0);
INSERT INTO public.product_variants(id,product_id,merchant_id,effective_policy,stock_quantity,available_units,attributes)
VALUES ('13131313-1313-4313-8313-131313131313','12121212-1212-4212-8212-121212121212','11111111-1111-4111-8111-111111111111','standard',NULL,NULL,'{"color":" Blue ","size":"  ","count":3,"enabled":true,"missing":null}');
UPDATE public.product_variants SET condition=' UK-Used ' WHERE id='13131313-1313-4313-8313-131313131313';

SET ROLE commerce_cart_shopper;
SELECT set_config('request.jwt.claims', '{"role":"commerce_cart_shopper","cart_scope":"session","exp":9999999999,"cart_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"buyer-a","cart_grant_id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}', false);
DO $$ DECLARE r jsonb; BEGIN
  UPDATE public.products SET condition=' Refurbished ' WHERE slug='simple';
  r := public.commerce_cart_add_chatwoot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','simple-1',1,'simple',NULL);
  IF r->>'ok' <> 'true' OR r->>'replayed' <> 'false' THEN RAISE EXCEPTION 'simple add failed: %',r; END IF;
  IF (SELECT canonical_command #>> '{item,condition}' FROM public.commerce_cart_operations WHERE operation_id='simple-1') <> 'open_box' THEN RAISE EXCEPTION 'simple condition alias did not normalize'; END IF;
  IF (SELECT canonical_command->>'quantity' FROM public.commerce_cart_operations WHERE operation_id='simple-1') <> '1' THEN RAISE EXCEPTION 'quantity not server-fixed'; END IF;
  r := public.commerce_cart_add_chatwoot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','simple-1',1,'unmanaged',NULL);
  IF r->>'code' <> 'idempotency_conflict' THEN RAISE EXCEPTION 'changed identity did not conflict: %',r; END IF;
  DELETE FROM public.products WHERE slug='simple';
  UPDATE public.commerce_carts SET state='checkout' WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  r := public.commerce_cart_add_chatwoot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','simple-1',1,'simple',NULL);
  IF r->>'ok' <> 'true' OR r->>'replayed' <> 'true' THEN RAISE EXCEPTION 'stale replay failed: %',r; END IF;
  r := public.commerce_cart_add_chatwoot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','locked-new-add',2,'unmanaged',NULL);
  IF r->>'code' <> 'cart_locked' THEN RAISE EXCEPTION 'new add bypassed cart lock: %',r; END IF;
  UPDATE public.commerce_carts SET state='active' WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  INSERT INTO public.products(id,merchant_id,slug,status,manage_stock,stock,stock_quantity)
  VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111','simple','active',true,2,2);
  r := public.commerce_cart_add_chatwoot('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cross-cart',1,'other',NULL);
  IF r->>'code' <> 'unauthorized' OR r->>'state' <> 'null' THEN RAISE EXCEPTION 'cross-cart disclosed state: %',r; END IF;
  r := public.commerce_cart_add_chatwoot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','foreign-product',2,'other',NULL);
  IF r->>'code' <> 'invalid_item' THEN RAISE EXCEPTION 'foreign merchant catalog product resolved: %',r; END IF;
END $$;

-- Strict serialized stock prefers authoritative available_units over the
-- scalar stock projection; inverse values catch precedence regressions.
DO $$ DECLARE r jsonb; BEGIN
  r := public.commerce_cart_add_chatwoot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','strict-empty',2,'variant','77777777-7777-4777-8777-777777777777');
  IF r->>'code' <> 'invalid_item' THEN RAISE EXCEPTION 'strict available_units=0 ignored: %',r; END IF;
  UPDATE public.product_variants SET available_units=2,stock_quantity=0 WHERE id='77777777-7777-4777-8777-777777777777';
  r := public.commerce_cart_add_chatwoot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','strict-in-stock',2,'variant','77777777-7777-4777-8777-777777777777');
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'strict default variant available_units positive rejected: %',r; END IF;
  UPDATE public.product_variants SET deleted_at=now() WHERE id='77777777-7777-4777-8777-777777777777';
  r := public.commerce_cart_add_chatwoot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','strict-in-stock',2,'variant','77777777-7777-4777-8777-777777777777');
  IF r->>'ok' <> 'true' OR r->>'replayed' <> 'true' THEN RAISE EXCEPTION 'inactive variant replay failed: %',r; END IF;
  DELETE FROM public.product_variants WHERE id='77777777-7777-4777-8777-777777777777';
  r := public.commerce_cart_add_chatwoot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','strict-in-stock',2,'variant','77777777-7777-4777-8777-777777777777');
  IF r->>'ok' <> 'true' OR r->>'replayed' <> 'true' THEN RAISE EXCEPTION 'deleted variant replay failed: %',r; END IF;
END $$;

-- Unmanaged scalar stock remains addable at zero; tracked scalar stock fails closed at zero.
DO $$ DECLARE r jsonb; BEGIN
  UPDATE public.products SET status='active' WHERE slug='simple';
  r := public.commerce_cart_add_chatwoot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','unmanaged-1',3,'unmanaged',NULL);
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'unmanaged product was rejected: %',r; END IF;
  r := public.commerce_cart_add_chatwoot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','unlimited-1',4,'unlimited',NULL);
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'serialized unlimited product was rejected: %',r; END IF;
  r := public.commerce_cart_add_chatwoot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','legacy-stock-1',5,'legacy-stock',NULL);
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'positive legacy stock was hidden by zero quantity: %',r; END IF;
  UPDATE public.products SET stock=0,stock_quantity=0 WHERE slug='simple';
  r := public.commerce_cart_add_chatwoot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','malformed-condition-1',6,'malformed-condition',NULL);
  IF r->>'code' <> 'invalid_item' OR r->>'currentVersion' <> '6' THEN RAISE EXCEPTION 'malformed snapshot error omitted current version: %',r; END IF;
  r := public.commerce_cart_add_chatwoot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','variant-parent-legacy-1',6,'variant-parent-legacy','13131313-1313-4313-8313-131313131313');
  IF r->>'ok' <> 'true' THEN RAISE EXCEPTION 'variant parent legacy stock fallback rejected stock_quantity=0, stock=4: %',r; END IF;
  IF (SELECT canonical_command #>> '{item,condition}' FROM public.commerce_cart_operations WHERE operation_id='variant-parent-legacy-1') <> 'used' THEN RAISE EXCEPTION 'variant condition alias did not normalize'; END IF;
  IF (SELECT canonical_command #> '{item,options}' FROM public.commerce_cart_operations WHERE operation_id='variant-parent-legacy-1') <> '{"color":"Blue"}'::jsonb THEN
    RAISE EXCEPTION 'variant attributes did not match storefront normalization';
  END IF;
  r := public.commerce_cart_add_chatwoot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','empty-1',7,'simple',NULL);
  IF r->>'code' <> 'invalid_item' THEN RAISE EXCEPTION 'tracked zero stock was accepted: %',r; END IF;
END $$;

-- A transaction rollback removes both the cart mutation and its add identity receipt.
BEGIN;
UPDATE public.products SET stock=2,stock_quantity=2 WHERE slug='simple';
SELECT public.commerce_cart_add_chatwoot('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','rollback-1',7,'simple',NULL);
ROLLBACK;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.commerce_cart_operations WHERE operation_id='rollback-1') THEN RAISE EXCEPTION 'rollback left a receipt'; END IF;
END $$;

RESET ROLE;
DO $$ BEGIN
  IF has_function_privilege('authenticated','public.commerce_cart_add_chatwoot(uuid,text,integer,text,uuid)','EXECUTE') THEN RAISE EXCEPTION 'authenticated role got direct add RPC'; END IF;
  IF NOT has_function_privilege('commerce_cart_shopper','public.commerce_cart_add_chatwoot(uuid,text,integer,text,uuid)','EXECUTE') THEN RAISE EXCEPTION 'shopper role lacks add RPC'; END IF;
END $$;
