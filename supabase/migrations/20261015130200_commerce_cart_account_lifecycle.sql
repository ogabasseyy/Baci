-- Recheck lifecycle while holding cart locks; issue proof expiry from the selected grant.
CREATE OR REPLACE FUNCTION public.commerce_cart_prepare_account_link(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx record; op public.commerce_cart_account_operations%ROWTYPE; saved uuid;
 selected_principal text:='customer-device:'||pg_catalog.gen_random_uuid()::text;
 selected uuid; source uuid; selected_grant uuid; source_grant uuid; v_choice text:=p_input->>'choice';
 v_operation text:=p_input->>'operationId'; v_digest text:=pg_catalog.md5(p_input::text); expiry timestamptz;
BEGIN
 SELECT * INTO ctx FROM public.commerce_cart_account_context();
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
 IF v_choice NOT IN ('keep_current','use_saved','merge') OR coalesce(length(v_operation),0) NOT BETWEEN 1 AND 96 THEN RETURN jsonb_build_object('ok',false,'code','invalid_item'); END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cc-device-revoke|'||ctx.merchant::text||'|'||ctx.device_principal,0));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cc-account|'||ctx.merchant::text||'|'||ctx.customer::text,0));
 PERFORM 1 FROM public.commerce_cart_account_context();
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
 SELECT * INTO op FROM public.commerce_cart_account_operations WHERE merchant_id=ctx.merchant AND customer_id=ctx.customer AND principal_id=ctx.principal AND operation_id=v_operation FOR UPDATE;
 IF FOUND THEN
  IF op.request_digest<>v_digest OR op.expires_at<=now() OR NOT (ctx.current_cart IS NOT DISTINCT FROM op.original_cart_id OR ctx.current_cart=op.selected_cart_id) THEN RETURN jsonb_build_object('ok',false,'code','idempotency_conflict'); END IF;
  RETURN jsonb_build_object('ok',true,'selectedCartId',op.selected_cart_id,'selectedGrantId',op.selected_grant_id,'sourceCartId',op.source_cart_id,'sourceGrantId',op.source_grant_id,'selectedPrincipalId',op.selected_principal_id,'finished',op.result IS NOT NULL);
 END IF;
 SELECT link.cart_id INTO saved FROM public.commerce_cart_customer_carts link JOIN public.commerce_carts cart ON cart.id=link.cart_id AND cart.merchant_id=link.merchant_id
 WHERE link.merchant_id=ctx.merchant AND link.customer_id=ctx.customer AND cart.expires_at>now() AND cart.state IN ('active','checkout');
 -- An omitted expectation states no observation, so only a supplied
 -- saved-cart id gates the link; keep_current may therefore acknowledge
 -- the saved cart while still rejecting a stale observed id.
 IF nullif(p_input->>'expectedSavedCartId','') IS NOT NULL AND nullif(p_input->>'expectedSavedCartId','')::uuid IS DISTINCT FROM saved THEN RETURN jsonb_build_object('ok',false,'code','refresh_required'); END IF;
 IF v_choice='use_saved' AND saved IS NULL THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF v_choice IN ('keep_current','merge') AND ctx.current_cart IS NULL THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF v_choice='merge' AND saved IS NOT NULL AND saved<>ctx.current_cart THEN
  IF (SELECT version FROM public.commerce_carts WHERE id=saved) IS DISTINCT FROM (p_input->>'expectedSavedVersion')::integer
    OR (SELECT version FROM public.commerce_carts WHERE id=ctx.current_cart) IS DISTINCT FROM (p_input->>'expectedCurrentVersion')::integer THEN RETURN jsonb_build_object('ok',false,'code','version_conflict'); END IF;
  source:=saved;
 END IF;
 selected:=CASE WHEN v_choice='use_saved' THEN saved ELSE ctx.current_cart END;
 -- Stable cart-before-grant lock ordering agrees with handoff and mutation.
 PERFORM 1 FROM public.commerce_carts WHERE merchant_id=ctx.merchant AND id IN (selected,source) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.commerce_carts WHERE merchant_id=ctx.merchant AND id IN(selected,source) AND (state NOT IN ('active','checkout') OR expires_at<=now()))
  OR NOT EXISTS(SELECT 1 FROM public.commerce_carts WHERE merchant_id=ctx.merchant AND id=selected AND state IN ('active','checkout') AND expires_at>now()) THEN RETURN jsonb_build_object('ok',false,'code','refresh_required'); END IF;
 IF v_choice='merge' AND source IS NOT NULL AND ((SELECT version FROM public.commerce_carts WHERE id=source) IS DISTINCT FROM (p_input->>'expectedSavedVersion')::integer OR (SELECT version FROM public.commerce_carts WHERE id=selected) IS DISTINCT FROM (p_input->>'expectedCurrentVersion')::integer) THEN RETURN jsonb_build_object('ok',false,'code','version_conflict'); END IF;
 SELECT least(expires_at,now()+interval '7 days') INTO expiry FROM public.commerce_carts WHERE id=selected AND merchant_id=ctx.merchant;
 INSERT INTO public.commerce_cart_grants(merchant_id,cart_id,principal_id,principal_type,expires_at,linked_customer_id,device_principal_id)
 VALUES(ctx.merchant,selected,selected_principal,'customer',expiry,ctx.customer,ctx.device_principal)
 ON CONFLICT(cart_id,principal_id) DO UPDATE SET principal_type='customer',linked_customer_id=EXCLUDED.linked_customer_id,expires_at=greatest(commerce_cart_grants.expires_at,EXCLUDED.expires_at)
 RETURNING id INTO selected_grant;
 IF source IS NOT NULL THEN
  SELECT least(expires_at,now()+interval '7 days') INTO expiry FROM public.commerce_carts WHERE id=source AND merchant_id=ctx.merchant;
  INSERT INTO public.commerce_cart_grants(merchant_id,cart_id,principal_id,principal_type,expires_at,linked_customer_id,device_principal_id)
  VALUES(ctx.merchant,source,selected_principal,'customer',expiry,ctx.customer,ctx.device_principal)
  ON CONFLICT(cart_id,principal_id) DO UPDATE SET principal_type='customer',linked_customer_id=EXCLUDED.linked_customer_id,expires_at=greatest(commerce_cart_grants.expires_at,EXCLUDED.expires_at)
  RETURNING id INTO source_grant;
 END IF;
 INSERT INTO public.commerce_cart_account_operations(merchant_id,customer_id,principal_id,operation_id,request_digest,choice,device_principal_id,original_grant_id,selected_principal_id,original_cart_id,selected_cart_id,source_cart_id,selected_grant_id,source_grant_id)
 VALUES(ctx.merchant,ctx.customer,ctx.principal,v_operation,v_digest,v_choice,ctx.device_principal,ctx.current_grant,selected_principal,ctx.current_cart,selected,source,selected_grant,source_grant);
 RETURN jsonb_build_object('ok',true,'selectedCartId',selected,'selectedGrantId',selected_grant,'sourceCartId',source,'sourceGrantId',source_grant,'selectedPrincipalId',selected_principal,'finished',false);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN jsonb_build_object('ok',false,'code','invalid_item');
END $$;

CREATE OR REPLACE FUNCTION public.commerce_cart_finish_account_link(p_operation_id text,p_handoff_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx record; op public.commerce_cart_account_operations%ROWTYPE; handoff public.commerce_cart_handoffs%ROWTYPE;
BEGIN
 SELECT * INTO ctx FROM public.commerce_cart_account_identity();
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cc-device-revoke|'||ctx.merchant::text||'|'||ctx.device_principal,0));
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cc-account|'||ctx.merchant::text||'|'||ctx.customer::text,0));
 PERFORM 1 FROM public.commerce_cart_account_identity();
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
 SELECT * INTO op FROM public.commerce_cart_account_operations WHERE merchant_id=ctx.merchant AND customer_id=ctx.customer AND principal_id=ctx.principal AND operation_id=p_operation_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.commerce_cart_device_retirements retired WHERE retired.merchant_id=ctx.merchant AND retired.device_principal_id=ctx.device_principal) THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
 IF NOT FOUND OR op.expires_at<=now() THEN RETURN jsonb_build_object('ok',false,'code','not_found'); END IF;
 IF op.original_cart_id IS DISTINCT FROM ctx.current_cart OR op.original_grant_id IS DISTINCT FROM ctx.current_grant THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
 IF ctx.current_grant IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.commerce_cart_grants WHERE id=ctx.current_grant AND merchant_id=ctx.merchant AND cart_id=ctx.current_cart AND principal_id=ctx.principal AND revoked_at IS NULL AND expires_at>now()) THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
 IF op.result IS NOT NULL THEN RETURN op.result||jsonb_build_object('replayed',true); END IF;
 IF op.source_cart_id IS NOT NULL THEN
  SELECT * INTO handoff FROM public.commerce_cart_handoffs WHERE id=p_handoff_id AND merchant_id=ctx.merchant AND source_cart_id=op.source_cart_id AND origin_principal_id=op.selected_principal_id;
  IF NOT FOUND OR handoff.redeemed_at IS NULL OR handoff.destination_attempt_id IS DISTINCT FROM 'account-merge:'||p_operation_id
    OR handoff.redemption_receipt->>'choice' IS DISTINCT FROM 'merge' OR handoff.redemption_receipt->>'destCartId' IS DISTINCT FROM op.source_cart_id::text
    OR handoff.redemption_receipt->>'principalId' IS DISTINCT FROM op.selected_principal_id THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
 END IF;
 IF op.source_cart_id IS NOT NULL THEN
  op.selected_cart_id:=(handoff.redemption_receipt->>'destCartId')::uuid;
  op.selected_grant_id:=(handoff.redemption_receipt->>'destGrantId')::uuid;
 END IF;
 PERFORM 1 FROM public.commerce_carts WHERE id=op.selected_cart_id AND merchant_id=ctx.merchant AND state IN ('active','checkout') AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','refresh_required'); END IF;
 PERFORM 1 FROM public.commerce_cart_grants WHERE id=op.selected_grant_id AND merchant_id=ctx.merchant AND cart_id=op.selected_cart_id AND principal_id=op.selected_principal_id AND linked_customer_id=ctx.customer AND revoked_at IS NULL AND expires_at>now();
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
 INSERT INTO public.commerce_cart_customer_carts(merchant_id,customer_id,cart_id) VALUES(ctx.merchant,ctx.customer,op.selected_cart_id)
 ON CONFLICT(merchant_id,customer_id) DO UPDATE SET cart_id=EXCLUDED.cart_id,updated_at=now();
 UPDATE public.commerce_cart_grants SET revoked_at=coalesce(revoked_at,now()) WHERE merchant_id=ctx.merchant AND principal_id=ctx.principal;
 UPDATE public.commerce_cart_account_operations SET selected_cart_id=op.selected_cart_id,selected_grant_id=op.selected_grant_id,result=jsonb_build_object('ok',true,'cartId',op.selected_cart_id,'grantId',op.selected_grant_id,'principalId',op.selected_principal_id,'grantExpiresAt',(SELECT expires_at FROM public.commerce_cart_grants WHERE id=op.selected_grant_id)) WHERE merchant_id=ctx.merchant AND customer_id=ctx.customer AND principal_id=ctx.principal AND operation_id=p_operation_id;
 RETURN jsonb_build_object('ok',true,'cartId',op.selected_cart_id,'grantId',op.selected_grant_id,'principalId',op.selected_principal_id,'grantExpiresAt',(SELECT expires_at FROM public.commerce_cart_grants WHERE id=op.selected_grant_id));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN jsonb_build_object('ok',false,'code','invalid_item');
END $$;

CREATE OR REPLACE FUNCTION public.commerce_cart_link_account(p_input jsonb,p_source_token_hash text DEFAULT NULL,p_handoff_id uuid DEFAULT NULL,p_destination jsonb DEFAULT '{"type":"web"}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE identity record; replay public.commerce_cart_account_operations%ROWTYPE; original jsonb:=auth.jwt(); prepared jsonb; result jsonb; issued jsonb; selected_principal text:='customer-device:'||pg_catalog.gen_random_uuid()::text;
 selected uuid; source uuid; hid uuid;
BEGIN
 IF original->>'role' IS DISTINCT FROM 'commerce_cart_account_linker' THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
 BEGIN
  SELECT * INTO identity FROM public.commerce_cart_account_identity();
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.commerce_cart_device_retirements retired WHERE retired.merchant_id=identity.merchant AND retired.device_principal_id=identity.device_principal) THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
  SELECT * INTO replay FROM public.commerce_cart_account_operations WHERE merchant_id=identity.merchant AND customer_id=identity.customer AND principal_id=identity.principal AND operation_id=p_input->>'operationId';
  IF FOUND AND replay.result IS NOT NULL THEN
   IF replay.request_digest<>pg_catalog.md5(p_input::text) OR replay.expires_at<=now() OR replay.original_cart_id IS DISTINCT FROM identity.current_cart OR replay.original_grant_id IS DISTINCT FROM identity.current_grant THEN RETURN jsonb_build_object('ok',false,'code','idempotency_conflict'); END IF;
   PERFORM 1 FROM public.commerce_cart_grants WHERE id=replay.selected_grant_id AND merchant_id=identity.merchant AND principal_id=replay.selected_principal_id AND linked_customer_id=identity.customer AND revoked_at IS NULL AND expires_at>now();
   IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unauthorized'); END IF;
   RETURN replay.result||jsonb_build_object('replayed',true,'grantExpiresAt',(SELECT expires_at FROM public.commerce_cart_grants WHERE id=replay.selected_grant_id));
  END IF;
  prepared:=public.commerce_cart_prepare_account_link(p_input);
  IF prepared->>'ok' IS DISTINCT FROM 'true' THEN result:=prepared; RAISE SQLSTATE 'P0C01' USING MESSAGE='account_link_rejected'; END IF;
  selected:=(prepared->>'selectedCartId')::uuid; source:=nullif(prepared->>'sourceCartId','')::uuid;
  IF source IS NOT NULL AND prepared->>'finished' IS DISTINCT FROM 'true' THEN
   IF p_source_token_hash IS NULL OR p_handoff_id IS NULL OR NOT (p_destination='{"type":"web"}'::jsonb OR p_destination='{"type":"native","app":"storefront"}'::jsonb) THEN result:=jsonb_build_object('ok',false,'code','invalid_item'); RAISE SQLSTATE 'P0C01' USING MESSAGE='account_link_rejected'; END IF;
   PERFORM set_config('request.jwt.claims',(original||jsonb_build_object('role','commerce_cart_shopper','cart_scope','session','cart_principal_id',prepared->>'selectedPrincipalId','cart_id',source,'cart_grant_id',prepared->>'sourceGrantId'))::text,true);
   issued:=public.commerce_cart_issue_handoff(p_source_token_hash,p_handoff_id,source,'account:'||(p_input->>'operationId'),p_destination);
   IF issued->>'ok' IS DISTINCT FROM 'true' THEN result:=issued; RAISE SQLSTATE 'P0C01' USING MESSAGE='account_link_rejected'; END IF;
   hid:=(issued->'handoff'->>'id')::uuid;
   PERFORM set_config('request.jwt.claims',(original||jsonb_build_object('role','commerce_cart_shopper','cart_scope','session','cart_principal_id',prepared->>'selectedPrincipalId','cart_id',selected,'cart_grant_id',prepared->>'selectedGrantId'))::text,true);
   result:=public.commerce_cart_redeem_handoff(p_token_hash=>p_source_token_hash,p_handoff_id=>hid,p_attempt_id=>'account-merge:'||(p_input->>'operationId'),p_choice=>'merge',p_caller=>(p_destination->>'type'),p_dest_cart_id=>selected,p_expected_incoming_version=>(p_input->>'expectedSavedVersion')::integer,p_expected_dest_version=>(p_input->>'expectedCurrentVersion')::integer,p_lines=>(p_input->'lines'),p_resolutions=>(p_input->'resolutions'));
   IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE SQLSTATE 'P0C01' USING MESSAGE='account_link_rejected'; END IF;
  END IF;
  PERFORM set_config('request.jwt.claims',original::text,true);
  result:=public.commerce_cart_finish_account_link(p_input->>'operationId',hid);
  IF result->>'ok' IS DISTINCT FROM 'true' THEN RAISE SQLSTATE 'P0C01' USING MESSAGE='account_link_rejected'; END IF;
  RETURN result;
 EXCEPTION WHEN SQLSTATE 'P0C01' THEN
  -- The subtransaction rolled back prepared grants, merge and account pointer.
  PERFORM set_config('request.jwt.claims',original::text,true);
  RETURN result;
 END;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 PERFORM set_config('request.jwt.claims',original::text,true);
 RETURN jsonb_build_object('ok',false,'code','invalid_item');
END $$;