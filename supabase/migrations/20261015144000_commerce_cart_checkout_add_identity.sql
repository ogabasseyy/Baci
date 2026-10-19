-- Restore absolute checkout authority deadlines without altering outer guards.
DO $repair$
DECLARE definition text; old text; replacement text;
BEGIN
 definition:=pg_get_functiondef('public.commerce_cart_prepare_checkout(uuid,integer,text)'::regprocedure);
 IF position('v_absolute_deadline timestamptz' IN definition)>0 THEN RETURN; END IF;
 old:=$old$  v_grant_expires_at timestamptz;$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'checkout declaration source mismatch'; END IF;
 definition:=replace(definition,old,$new$  v_grant_expires_at timestamptz;
  v_absolute_deadline timestamptz;$new$);
 old:=$old$  SELECT * INTO v_existing
  FROM public.commerce_cart_operations$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'checkout absolute authority source mismatch'; END IF;
 definition:=replace(definition,old,$new$  SELECT least(c.created_at+interval '7 days',g.created_at+interval '7 days'),
    least(g.expires_at,g.created_at+interval '7 days',c.created_at+interval '7 days')
  INTO v_absolute_deadline,v_grant_expires_at
  FROM public.commerce_carts c JOIN public.commerce_cart_grants g ON g.cart_id=c.id AND g.merchant_id=c.merchant_id
  WHERE c.id=p_cart_id AND c.merchant_id=v_merchant AND g.id=v_grant;
  IF v_absolute_deadline IS NULL OR v_absolute_deadline<=now() THEN
    RETURN jsonb_build_object('ok',false,'code','expired','replayed',false,'snapshot',null,'currentVersion',null);
  END IF;
  SELECT * INTO v_existing
  FROM public.commerce_cart_operations$new$);
 old:=$old$IF NOT FOUND OR v_session.status <> 'active' OR v_session.expires_at <= now() THEN$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'checkout replay deadline source mismatch'; END IF;
 definition:=replace(definition,old,$new$IF NOT FOUND OR v_session.status <> 'active' OR least(v_session.expires_at,v_session.created_at+interval '7 days',v_absolute_deadline) <= now() THEN$new$);
 old:=$old$      pg_catalog.jsonb_set(v_existing.result, '{replayed}', 'true', true),
      '{sessionExpiresAt}', pg_catalog.to_jsonb(v_session.expires_at), true);$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'checkout replay receipt source mismatch'; END IF;
 definition:=replace(definition,old,$new$      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(v_existing.result, '{replayed}', 'true', true),
        '{grantExpiresAt}',pg_catalog.to_jsonb(v_grant_expires_at),true),
      '{sessionExpiresAt}', pg_catalog.to_jsonb(least(v_session.expires_at,v_session.created_at+interval '7 days',v_absolute_deadline)), true);$new$);
 old:=$old$    AND status = 'active' AND expires_at > now()$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'checkout reuse deadline source mismatch'; END IF;
 definition:=replace(definition,old,$new$    AND status = 'active' AND expires_at > now() AND created_at+interval '7 days'>now()$new$);
 old:=$old$      v_principal, 'active', now() + interval '30 minutes'$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'checkout new session deadline source mismatch'; END IF;
 definition:=replace(definition,old,$new$      v_principal, 'active', least(now() + interval '30 minutes',v_absolute_deadline)$new$);
 old:=$old$  -- Extension is capped at the absolute cart lifetime$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'checkout reused session cap source mismatch'; END IF;
 definition:=replace(definition,old,$new$  UPDATE public.commerce_cart_checkout_sessions
  SET expires_at=least(expires_at,created_at+interval '7 days',v_absolute_deadline)
  WHERE id=v_session.id RETURNING * INTO v_session;

  -- Extension is capped at the absolute cart lifetime$new$);
 old:=$old$expires_at = greatest(expires_at, v_session.expires_at)$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>2 THEN RAISE EXCEPTION 'checkout row renewal source mismatch'; END IF;
 definition:=replace(definition,old,$new$expires_at = least(greatest(expires_at, v_session.expires_at),created_at+interval '7 days',v_absolute_deadline)$new$);
 EXECUTE definition;
END $repair$;

DO $repair$
DECLARE definition text; old text;
BEGIN
 definition:=pg_get_functiondef('public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)'::regprocedure);
 IF position('g.created_at+interval ''7 days''>now()' IN definition)>0 THEN RETURN; END IF;
 old:=$old$AND g.expires_at>now() AND g.revoked_at IS NULL$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'binding authority absolute deadline source mismatch'; END IF;
 definition:=replace(definition,old,$new$AND g.expires_at>now() AND g.created_at+interval '7 days'>now() AND g.revoked_at IS NULL$new$);
 old:=$old$  IF v_session.expires_at <= now() THEN$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'binding session absolute deadline source mismatch'; END IF;
 definition:=replace(definition,old,$new$  IF least(v_session.expires_at,v_session.created_at+interval '7 days') <= now() THEN$new$);
 old:=$old$  IF v_cart.expires_at <= now() THEN$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'binding cart absolute deadline source mismatch'; END IF;
 definition:=replace(definition,old,$new$  IF least(v_cart.expires_at,v_cart.created_at+interval '7 days') <= now() THEN$new$);
 EXECUTE definition;
END $repair$;

-- Match the final replace writer's normalized attachment identity on add.
DO $repair$
DECLARE definition text; old text; branch text; repaired text; start_at integer; end_at integer;
BEGIN
 definition:=pg_get_functiondef('public.commerce_cart_mutate_authorized_impl(uuid,text,integer,jsonb)'::regprocedure);
 start_at:=position('  IF v_type = ''add'' THEN' IN definition);
 end_at:=position('  ELSIF v_type = ''set_quantity'' THEN' IN definition);
 IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'add branch source mismatch'; END IF;
 branch:=substring(definition FROM start_at FOR end_at-start_at);
 IF position('AND negotiated_unit_price_minor IS NOT DISTINCT FROM v_negotiated' IN branch)>0 THEN RETURN; END IF;
 repaired:=branch;
 old:=$old$    PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);$old$;
 IF (length(repaired)-length(replace(repaired,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'add normalized negotiation source mismatch'; END IF;
 repaired:=replace(repaired,old,$new$    PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id, v_condition);
    v_neg_status:=public.commerce_cart_negotiation_status(v_merchant,v_product_id,v_variant_id,v_condition,v_negotiated,v_neg_status);$new$);
 old:=$old$      AND voucher_award_id IS NOT DISTINCT FROM v_voucher_award::uuid;$old$;
 IF (length(repaired)-length(replace(repaired,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'add attachment identity source mismatch'; END IF;
 repaired:=replace(repaired,old,$new$      AND voucher_award_id IS NOT DISTINCT FROM v_voucher_award::uuid
      AND negotiated_unit_price_minor IS NOT DISTINCT FROM v_negotiated
      AND negotiation_status IS NOT DISTINCT FROM v_neg_status;$new$);
 definition:=overlay(definition PLACING repaired FROM start_at FOR end_at-start_at);
 EXECUTE definition;
END $repair$;

-- Explicit JSON null records an observed absence. Omitted expectations retain
-- the legacy no-observation contract; exact retries still replay before fences.
DO $repair$
DECLARE definition text; old text;
BEGIN
 definition:=pg_get_functiondef('public.commerce_cart_prepare_account_link(jsonb)'::regprocedure);
 IF position('p_input ? ''expectedSavedCartId'' AND' IN definition)>0 THEN RETURN; END IF;
 old:=$old$ -- An omitted expectation states no observation, so only a supplied
 -- saved-cart id gates the link; keep_current may therefore acknowledge
 -- the saved cart while still rejecting a stale observed id.
 IF nullif(p_input->>'expectedSavedCartId','') IS NOT NULL AND nullif(p_input->>'expectedSavedCartId','')::uuid IS DISTINCT FROM saved THEN RETURN jsonb_build_object('ok',false,'code','refresh_required'); END IF;$old$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'account saved observation source mismatch'; END IF;
 definition:=replace(definition,old,$new$ -- An omitted key states no observation; explicit null acknowledges absence.
 -- The account lock serializes this comparison with another device's save.
 IF p_input ? 'expectedSavedCartId' AND nullif(p_input->>'expectedSavedCartId','')::uuid IS DISTINCT FROM saved THEN RETURN jsonb_build_object('ok',false,'code','refresh_required'); END IF;$new$);
 EXECUTE definition;
END $repair$;
