-- Full-schema legacy MCP offer projection and migration.
BEGIN;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
INSERT INTO public.merchants(id,slug,email,business_name,is_published,premium_features,payout_currency)
VALUES ('11111111-1111-4111-8111-111111111111','legacy-offer-canonical',
  'legacy-offer@example.test','Legacy offer fixture',true,'["shared_cart"]','NGN')
ON CONFLICT(id) DO UPDATE SET is_published=true,premium_features=excluded.premium_features,payout_currency='NGN';
INSERT INTO public.products(id,merchant_id,name,slug,price,status,stock_quantity,stock,manage_stock)
VALUES ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111',
  'Legacy offer product','legacy-offer-product',50,'active',10,10,true)
ON CONFLICT(id) DO UPDATE SET status='active',stock_quantity=10,stock=10;
\ir commerce_cart_legacy_offer_owner.sql
-- The owner-context output must also survive the real migration writer.
DO $$
DECLARE
  merchant uuid := '11111111-1111-4111-8111-111111111111';
  product uuid := '44444444-4444-4444-8444-444444444444';
  offer uuid := 'abcdefab-cdef-4abc-8def-abcdefabcdef';
  token text := repeat('9',64);
  hash text := encode(sha256(token::bytea),'hex');
  ctx jsonb;
  result jsonb;
  cart uuid;
BEGIN
  INSERT INTO public.product_offers(id,product_id,merchant_id,condition,price,stock_quantity,status)
  VALUES(offer,product,merchant,'used',40,4,'active');
  INSERT INTO public.mcp_guest_carts(token,items,expires_at,version,merchant_id)
  VALUES(token,jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1,'offer_id',upper(offer::text))),now()+interval '1 day',1,merchant);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper',
    'exp',9999999999,'cart_scope','bootstrap','cart_merchant_id',merchant,
    'cart_principal_id','legacy-offer-migration','cart_legacy_provider','mcp','cart_legacy_hash',hash)::text,true);
  ctx:=public.commerce_cart_legacy_owner_context('mcp',hash);
  result:=public.commerce_cart_migrate_legacy('mcp',hash,'legacy-offer-import',ctx->'lines',ctx->>'legacyVersion',ctx->>'currency');
  IF result->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'legacy offer migration failed: %',result;
  END IF;
  cart:=(result->'state'->>'cartId')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.commerce_cart_lines l WHERE l.cart_id=cart AND l.product_id=product AND l.offer_id=offer) THEN
    RAISE EXCEPTION 'legacy migration lost exact offer identity';
  END IF;
END $$;
ROLLBACK;
