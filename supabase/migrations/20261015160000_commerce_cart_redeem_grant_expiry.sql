-- Return the selected grant expiry from handoff redemption so the
-- route caps the replacement session proof (and its cookie) at the
-- grant that actually backs it, not the later cart expiry.
CREATE OR REPLACE FUNCTION public.commerce_cart_redeem_handoff(
 p_token_hash text,p_handoff_id uuid,p_attempt_id text,p_choice text,p_caller text,p_dest_cart_id uuid,
 p_expected_incoming_version integer,p_expected_dest_version integer,p_lines jsonb,p_resolutions jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claims jsonb:=auth.jwt(); handoff public.commerce_cart_handoffs%ROWTYPE; merchant uuid; grant_id uuid; result jsonb;
BEGIN
 IF NOT public.commerce_cart_device_is_active() THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','state',null,'replayed',false); END IF;
 -- Match the coverage executor before taking any handoff/cart row locks.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cc-handoff|' || p_token_hash, 0));
 IF p_choice='merge' THEN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR p_expected_incoming_version IS NULL OR p_expected_dest_version IS NULL
    OR p_expected_incoming_version<1 OR p_expected_dest_version<1 OR p_dest_cart_id IS NULL THEN
   RETURN jsonb_build_object('ok',false,'code','invalid_item','state',null,'replayed',false);
  END IF;
  merchant:=(claims->>'cart_merchant_id')::uuid;
  SELECT * INTO handoff FROM public.commerce_cart_handoffs
  WHERE id=p_handoff_id AND handoff_hash=p_token_hash AND merchant_id=merchant FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','not_found','state',null,'replayed',false); END IF;
  -- Consumed grants reconcile through the original attempt-bound receipt.
  IF handoff.redeemed_at IS NULL THEN
   IF (claims->>'cart_id')::uuid IS DISTINCT FROM p_dest_cart_id OR claims->>'cart_scope' IS DISTINCT FROM 'session' THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','state',null,'replayed',false); END IF;
   PERFORM 1 FROM public.commerce_carts WHERE merchant_id=merchant AND id IN(handoff.source_cart_id,p_dest_cart_id) ORDER BY id FOR UPDATE;
   SELECT id INTO grant_id FROM public.commerce_cart_grants WHERE id=(claims->>'cart_grant_id')::uuid AND merchant_id=merchant AND cart_id=p_dest_cart_id
     AND principal_id=claims->>'cart_principal_id' AND expires_at>now() AND revoked_at IS NULL AND 'replace'=ANY(allowed_operations) FOR UPDATE;
   IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','unauthorized','state',null,'replayed',false); END IF;
   IF EXISTS(SELECT 1 FROM public.commerce_cart_lines l WHERE l.merchant_id=merchant AND l.cart_id IN(handoff.source_cart_id,p_dest_cart_id)
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) line WHERE line->'item'->>'productId'=l.product_id::text
      AND nullif(line->'item'->>'variantId','') IS NOT DISTINCT FROM l.variant_id::text
      AND nullif(line->'item'->>'condition','') IS NOT DISTINCT FROM l.condition
      AND coalesce(line->'item'->'options','{}'::jsonb)=coalesce(l.options,'{}'::jsonb))) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_item','state',null,'replayed',false);
   END IF;
   -- Exact sibling lane coverage.
   IF EXISTS(SELECT 1 FROM public.commerce_cart_lines l
    WHERE l.merchant_id=merchant AND l.cart_id IN(handoff.source_cart_id,p_dest_cart_id)
    AND EXISTS(SELECT 1 FROM public.commerce_cart_lines sibling
      WHERE sibling.merchant_id=merchant AND sibling.cart_id IN(handoff.source_cart_id,p_dest_cart_id)
        AND sibling.product_id=l.product_id AND sibling.variant_id IS NOT DISTINCT FROM l.variant_id
        AND sibling.condition IS NOT DISTINCT FROM l.condition AND sibling.options=l.options
      GROUP BY sibling.cart_id HAVING count(*)>1)
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) line
      CROSS JOIN LATERAL public.commerce_cart_parse_input_line(line) parsed
      WHERE parsed.pi_product=l.product_id AND parsed.pi_variant IS NOT DISTINCT FROM l.variant_id
        AND parsed.pi_condition IS NOT DISTINCT FROM l.condition AND parsed.pi_options=coalesce(l.options,'{}'::jsonb)
        AND ((NOT (line ? 'sourceLineId')
          AND parsed.pi_voucher_token IS NOT DISTINCT FROM l.voucher_token
          AND parsed.pi_voucher_award IS NOT DISTINCT FROM l.voucher_award_id::text
          AND parsed.pi_negotiated IS NOT DISTINCT FROM l.negotiated_unit_price_minor
          AND parsed.pi_neg_status IS NOT DISTINCT FROM l.negotiation_status)
        OR EXISTS(SELECT 1 FROM public.commerce_cart_lines selected
          WHERE selected.id::text=line->>'sourceLineId' AND selected.merchant_id=merchant
            AND selected.cart_id IN(handoff.source_cart_id,p_dest_cart_id)
            AND selected.product_id=l.product_id AND selected.variant_id IS NOT DISTINCT FROM l.variant_id
            AND selected.condition IS NOT DISTINCT FROM l.condition AND selected.options=l.options
            AND selected.voucher_token IS NOT DISTINCT FROM l.voucher_token
            AND selected.voucher_award_id IS NOT DISTINCT FROM l.voucher_award_id
            AND selected.negotiated_unit_price_minor IS NOT DISTINCT FROM l.negotiated_unit_price_minor
            AND selected.negotiation_status IS NOT DISTINCT FROM l.negotiation_status)))) THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_item','state',null,'replayed',false);
   END IF;
  END IF;
 ELSIF claims->>'cart_scope'='bootstrap' AND EXISTS(SELECT 1 FROM public.commerce_cart_grants g WHERE g.merchant_id=(claims->>'cart_merchant_id')::uuid AND g.principal_id=claims->>'cart_principal_id' AND g.revoked_at IS NOT NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','unauthorized','state',null,'replayed',false);
 END IF;
 result:=public.commerce_cart_redact_handoff_conflicts(public.commerce_cart_redeem_handoff_coverage_impl(p_token_hash,p_handoff_id,p_attempt_id,p_choice,p_caller,p_dest_cart_id,p_expected_incoming_version,p_expected_dest_version,p_lines,p_resolutions));
 -- Surface the selected grant's own expiry so the route can cap the
 -- replacement proof and cookie to it: keep_existing reuses a grant
 -- that can expire well before the cart it authorizes.
 IF coalesce((result->>'ok')::boolean,false) AND nullif(result->>'grantId','') IS NOT NULL THEN
  result:=result||jsonb_build_object('grantExpiresAt',(SELECT expires_at FROM public.commerce_cart_grants WHERE id=(result->>'grantId')::uuid));
 END IF;
 RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RETURN jsonb_build_object('ok',false,'code','invalid_item','state',null,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.commerce_cart_redeem_handoff(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commerce_cart_redeem_handoff(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb) TO commerce_cart_shopper;
