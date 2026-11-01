-- The authenticated bootstrap owner context must carry MCP offer identity.
DO $$
DECLARE
  merchant uuid := '11111111-1111-4111-8111-111111111111';
  product uuid := '44444444-4444-4444-8444-444444444444';
  offer uuid := 'abcdefab-cdef-4abc-8def-abcdefabcdef';
  token text := repeat('f', 64);
  hash text := encode(sha256(token::bytea),'hex');
  ctx jsonb;
BEGIN
  UPDATE public.merchants SET premium_features='["shared_cart"]',payout_currency='NGN' WHERE id=merchant;
  INSERT INTO public.mcp_guest_carts(token,items,expires_at,version,merchant_id)
  VALUES(token,jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1,'offer_id',upper(offer::text))),now()+interval '1 day',1,merchant);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','commerce_cart_shopper',
    'exp',9999999999,'cart_scope','bootstrap','cart_merchant_id',merchant,
    'cart_principal_id','offer-legacy-owner','cart_legacy_provider','mcp','cart_legacy_hash',hash)::text,true);
  ctx:=public.commerce_cart_legacy_owner_context('mcp',hash);
  IF ctx->>'ok' IS DISTINCT FROM 'true'
    OR (ctx->'lines'->0->'item'->>'offerId')::uuid IS DISTINCT FROM offer THEN
    RAISE EXCEPTION 'verified legacy context lost offer identity: %',ctx;
  END IF;
  UPDATE public.mcp_guest_carts SET items=jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1,'offer_id','invalid')) WHERE token_hash=hash;
  ctx:=public.commerce_cart_legacy_owner_context('mcp',hash);
  IF ctx->>'code' IS DISTINCT FROM 'invalid_item' THEN
    RAISE EXCEPTION 'malformed legacy offer was not rejected: %',ctx;
  END IF;
  UPDATE public.mcp_guest_carts SET items=jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1,'offer_id',NULL)) WHERE token_hash=hash;
  ctx:=public.commerce_cart_legacy_owner_context('mcp',hash);
  IF ctx->>'ok' IS DISTINCT FROM 'true' OR ctx->'lines'->0->'item' ? 'offerId' THEN
    RAISE EXCEPTION 'legacy null offer did not retain parent-only semantics: %',ctx;
  END IF;
END $$;
