-- UCP lane metadata in the verified legacy bridge: rows persisted by
-- the UCP create path now carry variant_id, condition, and
-- variant_attributes. The owner-context guard previously classified
-- every such line as invalid_item, so enrolled variant/condition
-- carts could never migrate. Permit the supported lane fields and
-- translate them into canonical line identity.
CREATE OR REPLACE FUNCTION public.commerce_cart_legacy_owner_context(p_provider text,p_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c jsonb:=auth.jwt(); merchant uuid; principal text; agent text; legacy record; ref public.commerce_cart_legacy_refs%ROWTYPE; grant_row public.commerce_cart_grants%ROWTYPE; lines jsonb; v_currency text;
BEGIN
 IF c->>'role' IS DISTINCT FROM 'commerce_cart_shopper' OR c->>'cart_scope' IS DISTINCT FROM 'bootstrap'
  OR c->>'cart_legacy_provider' IS DISTINCT FROM p_provider OR c->>'cart_legacy_hash' IS DISTINCT FROM p_hash
  OR p_provider NOT IN ('mcp','ucp') OR p_hash !~ '^[a-f0-9]{64}$'
  OR coalesce((c->>'exp')::numeric,0)<=extract(epoch FROM now()) THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
 merchant:=(c->>'cart_merchant_id')::uuid; principal:=c->>'cart_principal_id'; agent:=nullif(c->>'cart_legacy_agent_id','');
 IF merchant IS NULL OR coalesce(principal,'')='' OR (p_provider='ucp' AND agent IS NULL) THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.merchants WHERE id=merchant AND premium_features @> '["shared_cart"]'::jsonb) THEN RETURN jsonb_build_object('ok',false,'code','merchant_unavailable'); END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cc-legacy|'||merchant::text||'|'||p_provider||'|'||p_hash,0));
 SELECT * INTO ref FROM public.commerce_cart_legacy_refs WHERE merchant_id=merchant AND provider=p_provider AND legacy_hash=p_hash;
 IF FOUND THEN
  IF ref.receipt->>'bridge_owner_principal' IS DISTINCT FROM principal OR nullif(ref.receipt->>'bridge_agent_id','') IS DISTINCT FROM agent THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
  SELECT * INTO grant_row FROM public.commerce_cart_grants g WHERE g.cart_id=ref.cart_id AND g.merchant_id=merchant AND g.principal_id=principal AND g.revoked_at IS NULL AND g.expires_at>now();
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','expired'); END IF;
  IF EXISTS(SELECT 1 FROM public.commerce_cart_device_retirements WHERE merchant_id=merchant AND device_principal_id=coalesce(grant_row.device_principal_id,principal)) THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
  RETURN jsonb_build_object('ok',true,'cartId',ref.cart_id,'grantId',grant_row.id,'grantExpiresAt',grant_row.expires_at,'allowedOperations',grant_row.allowed_operations);
 END IF;
 IF p_provider='mcp' THEN
  SELECT public.commerce_cart_resolve_merchant_currency(payout_currency,country) INTO v_currency FROM public.merchants WHERE id=merchant;
  IF v_currency IS NULL OR v_currency !~ '^[A-Z]{3}$' THEN RETURN jsonb_build_object('ok',false,'code','merchant_unavailable'); END IF;
  SELECT * INTO legacy FROM public.mcp_guest_carts WHERE token_hash=p_hash FOR UPDATE;
  IF NOT FOUND OR legacy.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(legacy.items) x WHERE x - 'product_id' - 'quantity' <> '{}'::jsonb) THEN RETURN jsonb_build_object('ok',false,'code','invalid_item'); END IF;
  IF legacy.merchant_id IS NULL THEN
   -- Historical MCP rows predate merchant ownership. Bind only when every
   -- stored product independently identifies this merchant; empty rows cannot.
   IF jsonb_array_length(legacy.items)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(legacy.items) x WHERE NOT EXISTS(SELECT 1 FROM public.products p WHERE p.id::text=x->>'product_id' AND p.merchant_id=merchant)) THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
   UPDATE public.mcp_guest_carts SET merchant_id=merchant WHERE token_hash=p_hash AND merchant_id IS NULL;
  ELSIF legacy.merchant_id<>merchant THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('item',jsonb_build_object('productId',x->>'product_id'),'quantity',x->'quantity')),'[]'::jsonb) INTO lines FROM jsonb_array_elements(legacy.items) x;
  RETURN jsonb_build_object('ok',true,'lines',lines,'legacyVersion',legacy.version::text,'currency',v_currency);
 ELSE
  SELECT * INTO legacy FROM public.agentic_cart_sessions WHERE cart_id_hash=p_hash AND merchant_id=merchant FOR UPDATE;
  IF NOT FOUND OR legacy.agent_id IS DISTINCT FROM agent OR legacy.status<>'active' OR legacy.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(legacy.cart_items) x WHERE x - 'id' - 'quantity' - 'variant_id' - 'condition' - 'variant_attributes' <> '{}'::jsonb) THEN RETURN jsonb_build_object('ok',false,'code','invalid_item'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('item',jsonb_build_object('productId',x->>'id')
   || CASE WHEN x->>'variant_id' IS NOT NULL THEN jsonb_build_object('variantId',x->>'variant_id') ELSE '{}'::jsonb END
   || CASE WHEN x->>'condition' IS NOT NULL THEN jsonb_build_object('condition',x->>'condition') ELSE '{}'::jsonb END
   || CASE WHEN x->'variant_attributes' IS NOT NULL THEN jsonb_build_object('options',x->'variant_attributes') ELSE '{}'::jsonb END,'quantity',x->'quantity')),'[]'::jsonb) INTO lines FROM jsonb_array_elements(legacy.cart_items) x;
  RETURN jsonb_build_object('ok',true,'lines',lines,'legacyVersion',legacy.updated_at::text,'currency',legacy.currency);
 END IF;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN jsonb_build_object('ok',false,'code','unauthorized');
END $$;
REVOKE ALL ON FUNCTION public.commerce_cart_legacy_owner_context(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commerce_cart_legacy_owner_context(text,text) TO commerce_cart_shopper;
