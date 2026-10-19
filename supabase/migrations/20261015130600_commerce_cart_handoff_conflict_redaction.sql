-- Conflict choices reveal offer presence, never transferable voucher credentials
-- or private negotiated terms from the source device.
CREATE FUNCTION public.commerce_cart_redact_handoff_conflicts(p_result jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN jsonb_typeof(p_result->'conflicts')='array' THEN
  jsonb_set(p_result,'{conflicts}',coalesce((
   SELECT jsonb_agg(conflict.value||jsonb_build_object(
    'existing',(conflict.value->'existing')-'voucherToken'-'voucherAwardId'-'negotiatedUnitPriceMinor'-'negotiationStatus'
      ||jsonb_build_object('hasVoucher',coalesce(nullif(conflict.value->'existing'->>'voucherToken',''),'')<>'' OR coalesce(nullif(conflict.value->'existing'->>'voucherAwardId',''),'')<>'',
        'hasNegotiation',conflict.value->'existing'->>'negotiatedUnitPriceMinor' IS NOT NULL),
    'incoming',(conflict.value->'incoming')-'voucherToken'-'voucherAwardId'-'negotiatedUnitPriceMinor'-'negotiationStatus'
      ||jsonb_build_object('hasVoucher',coalesce(nullif(conflict.value->'incoming'->>'voucherToken',''),'')<>'' OR coalesce(nullif(conflict.value->'incoming'->>'voucherAwardId',''),'')<>'',
        'hasNegotiation',conflict.value->'incoming'->>'negotiatedUnitPriceMinor' IS NOT NULL)))
   FROM jsonb_array_elements(p_result->'conflicts') conflict
  ),'[]'::jsonb)) ELSE p_result END
$$;
REVOKE ALL ON FUNCTION public.commerce_cart_redact_handoff_conflicts(jsonb) FROM PUBLIC,anon,authenticated,service_role,commerce_cart_shopper,commerce_cart_receiver,commerce_cart_worker;

CREATE OR REPLACE FUNCTION public.commerce_cart_redeem_handoff(
 p_token_hash text,p_handoff_id uuid,p_attempt_id text,p_choice text,p_caller text,p_dest_cart_id uuid,
 p_expected_incoming_version integer,p_expected_dest_version integer,p_lines jsonb,p_resolutions jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claims jsonb:=auth.jwt(); handoff public.commerce_cart_handoffs%ROWTYPE; merchant uuid; grant_id uuid;
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
   -- The versioned merge protocol has one context choice per identity. Do not
   -- silently drop multiple same-identity voucher lines within one source.
   IF EXISTS(SELECT 1 FROM public.commerce_cart_lines l WHERE l.merchant_id=merchant AND l.cart_id IN(handoff.source_cart_id,p_dest_cart_id)
     GROUP BY l.cart_id,l.product_id,l.variant_id,l.condition,l.options HAVING count(*)>1) THEN
    RETURN jsonb_build_object('ok',false,'code','merge_conflict','state',null,'replayed',false);
   END IF;
  END IF;
 ELSIF claims->>'cart_scope'='bootstrap' AND EXISTS(SELECT 1 FROM public.commerce_cart_grants g WHERE g.merchant_id=(claims->>'cart_merchant_id')::uuid AND g.principal_id=claims->>'cart_principal_id' AND g.revoked_at IS NOT NULL) THEN
  RETURN jsonb_build_object('ok',false,'code','unauthorized','state',null,'replayed',false);
 END IF;
 RETURN public.commerce_cart_redact_handoff_conflicts(public.commerce_cart_redeem_handoff_coverage_impl(p_token_hash,p_handoff_id,p_attempt_id,p_choice,p_caller,p_dest_cart_id,p_expected_incoming_version,p_expected_dest_version,p_lines,p_resolutions));
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RETURN jsonb_build_object('ok',false,'code','invalid_item','state',null,'replayed',false);
END $$;
REVOKE ALL ON FUNCTION public.commerce_cart_redeem_handoff(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.commerce_cart_redeem_handoff(text,uuid,text,text,text,uuid,integer,integer,jsonb,jsonb) TO commerce_cart_shopper;
