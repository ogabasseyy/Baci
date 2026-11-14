-- Included by run_commerce_cart_remaining_review.py after the real cart RPC
-- migration chain. Only the private PDP projection is stubbed in that runner.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS slug text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS condition text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS default_variant_id uuid;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS has_condition_offers boolean DEFAULT false;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS condition text;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS attributes jsonb DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION private.get_storefront_pdp_core_v2(uuid,text,uuid)
RETURNS TABLE(resolution_status text, product_data jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT 'found'::text, jsonb_build_object(
    'id', p.id, 'merchant_id', p.merchant_id, 'slug', p.slug, 'status', p.status,
    'has_variants', p.has_variants, 'has_condition_offers', p.has_condition_offers,
    'manage_stock', p.manage_stock, 'stock', p.stock, 'stock_quantity', p.stock_quantity,
    'condition', p.condition, 'effective_policy', p.inventory_tracking_policy,
    'inventory_tracking_policy', p.inventory_tracking_policy,
    'product_variants', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', v.id, 'product_id', v.product_id,
      'inventory_tracking_policy', v.inventory_tracking_policy,
      'stock_quantity', v.stock_quantity, 'condition', v.condition, 'attributes', v.attributes
    )) FROM public.product_variants v WHERE v.product_id=p.id AND v.merchant_id=p.merchant_id), '[]'::jsonb)
  )
  FROM public.products p
  WHERE p.merchant_id=$1 AND p.status='active' AND lower(p.slug)=lower(trim($2))
  LIMIT 1
$$;

\ir ../migrations/20261114124820_chatwoot_cart_add_receipts.sql

INSERT INTO public.commerce_carts(id,merchant_id,expires_at)
VALUES('aaaaaaaa-ffff-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111',now()+interval '1 day');
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,allowed_operations,expires_at)
VALUES('cccccccc-ffff-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','aaaaaaaa-ffff-4aaa-8aaa-aaaaaaaaaaaa','chatwoot-contract',ARRAY['add'],now()+interval '1 day');
INSERT INTO public.products(id,merchant_id,slug,status,price,stock,stock_quantity,manage_stock,has_variants,inventory_tracking_policy,has_condition_offers)
VALUES('eeeeeeee-ffff-4eee-8eee-eeeeeeeeeeee','11111111-1111-4111-8111-111111111111','chatwoot-contract-product','active',42,2,2,true,false,'off',false);
INSERT INTO public.products(id,merchant_id,slug,status,price,stock,stock_quantity,manage_stock,has_variants,inventory_tracking_policy,has_condition_offers)
VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff','22222222-2222-4222-8222-222222222222','foreign-merchant-product','active',42,2,2,true,false,'off',false);
INSERT INTO public.products(id,merchant_id,slug,status,price,stock,stock_quantity,manage_stock,has_variants,inventory_tracking_policy,has_condition_offers,default_variant_id)
VALUES('88888888-ffff-4888-8888-888888888888','11111111-1111-4111-8111-111111111111','chatwoot-default-variant','active',42,2,2,true,true,'off',false,'77777777-ffff-4777-8777-777777777777');
INSERT INTO public.product_variants(id,product_id,merchant_id,price_override,stock_quantity,inventory_tracking_policy,attributes,is_active,status)
VALUES('77777777-ffff-4777-8777-777777777777','88888888-ffff-4888-8888-888888888888','11111111-1111-4111-8111-111111111111',NULL,2,'off','{"color":"Black"}',true,'active');

SET ROLE commerce_cart_shopper;
SET request.jwt.claims='{"role":"commerce_cart_shopper","exp":9999999999,"cart_scope":"session","cart_merchant_id":"11111111-1111-4111-8111-111111111111","cart_principal_id":"chatwoot-contract","cart_id":"aaaaaaaa-ffff-4aaa-8aaa-aaaaaaaaaaaa","cart_grant_id":"cccccccc-ffff-4ccc-8ccc-cccccccccccc"}';
DO $$ DECLARE r jsonb; BEGIN
  r:=public.commerce_cart_add_chatwoot('aaaaaaaa-ffff-4aaa-8aaa-aaaaaaaaaaaa','chatwoot-contract-add',1,'chatwoot-contract-product',NULL);
  IF r->>'ok' <> 'true' OR r->>'replayed' <> 'false' THEN RAISE EXCEPTION 'canonical cart RPC add failed: %',r; END IF;
  IF (SELECT quantity FROM public.commerce_cart_lines WHERE cart_id='aaaaaaaa-ffff-4aaa-8aaa-aaaaaaaaaaaa') IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'canonical add quantity was not fixed to one'; END IF;
  r:=public.commerce_cart_add_chatwoot('aaaaaaaa-ffff-4aaa-8aaa-aaaaaaaaaaaa','chatwoot-default-variant-add',2,'chatwoot-default-variant','77777777-ffff-4777-8777-777777777777');
  IF r->>'ok' <> 'true' OR NOT EXISTS(SELECT 1 FROM public.commerce_cart_lines WHERE cart_id='aaaaaaaa-ffff-4aaa-8aaa-aaaaaaaaaaaa' AND variant_id='77777777-ffff-4777-8777-777777777777') THEN RAISE EXCEPTION 'default variant was not purchasable: %',r; END IF;
END $$;
RESET ROLE;
DELETE FROM public.products WHERE id='eeeeeeee-ffff-4eee-8eee-eeeeeeeeeeee';
UPDATE public.commerce_carts SET state='checkout' WHERE id='aaaaaaaa-ffff-4aaa-8aaa-aaaaaaaaaaaa';
SET ROLE commerce_cart_shopper;
DO $$ DECLARE r jsonb; BEGIN
  r:=public.commerce_cart_add_chatwoot('aaaaaaaa-ffff-4aaa-8aaa-aaaaaaaaaaaa','chatwoot-contract-add',1,'chatwoot-contract-product',NULL);
  IF r->>'ok' <> 'true' OR r->>'replayed' <> 'true' THEN RAISE EXCEPTION 'canonical lost-response replay after deletion failed: %',r; END IF;
  r:=public.commerce_cart_add_chatwoot('aaaaaaaa-ffff-4aaa-8aaa-aaaaaaaaaaaa','chatwoot-locked-add',3,'foreign-merchant-product',NULL);
  IF r->>'code' <> 'cart_locked' THEN RAISE EXCEPTION 'locked cart accepted a new add: %',r; END IF;
  r:=public.commerce_cart_add_chatwoot('aaaaaaaa-ffff-4aaa-8aaa-aaaaaaaaaaaa','chatwoot-contract-add',1,'foreign-merchant-product',NULL);
  IF r->>'code' <> 'idempotency_conflict' OR r->>'state' <> 'null' THEN RAISE EXCEPTION 'changed identity leaked cart or avoided conflict: %',r; END IF;
  r:=public.commerce_cart_add_chatwoot('bbbbbbbb-ffff-4bbb-8bbb-bbbbbbbbbbbb','other-cart',1,'foreign-merchant-product',NULL);
  IF r->>'code' <> 'unauthorized' OR r->>'state' <> 'null' THEN RAISE EXCEPTION 'cross-cart call disclosed state: %',r; END IF;
END $$;
RESET ROLE;
