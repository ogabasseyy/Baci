-- A reserved quiz prize is already bound to an award and a product. Validate
-- any selected offer against that authority before the reserved-order branch.
CREATE OR REPLACE FUNCTION private.validate_serialized_quiz_voucher_offer(
 p_merchant_id uuid, p_user_id uuid, p_award_id uuid, p_product_id uuid, p_item jsonb
) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
 v_exact text := nullif(pg_catalog.btrim(p_item->>'offer_id'), '');
 v_condition_offer text := nullif(pg_catalog.btrim(p_item->>'condition_offer_id'), '');
 v_offer_id uuid;
BEGIN
 IF v_exact IS NULL AND v_condition_offer IS NULL THEN RETURN; END IF;
 IF public.commerce_cart_condition_pool_is_quantity_managed(p_merchant_id,p_product_id) IS NOT TRUE THEN RETURN; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.products product
  LEFT JOIN public.product_variants anchor ON anchor.id=product.inventory_anchor_variant_id
   AND anchor.product_id=product.id AND anchor.merchant_id=product.merchant_id
  WHERE product.id=p_product_id AND product.merchant_id=p_merchant_id
   AND public.get_effective_inventory_tracking_policy(product.inventory_tracking_policy,anchor.inventory_tracking_policy)
    IN ('serialized_strict','serialized_then_unlimited')
 ) THEN RETURN; END IF;
 BEGIN
  v_offer_id := coalesce(v_exact,v_condition_offer)::uuid;
  IF v_exact IS NOT NULL AND v_condition_offer IS NOT NULL AND v_exact::uuid IS DISTINCT FROM v_condition_offer::uuid THEN
   RAISE EXCEPTION 'quiz_voucher_offer_invalid' USING ERRCODE='22023';
  END IF;
 EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'quiz_voucher_offer_invalid' USING ERRCODE='22023';
 END;
 IF NOT EXISTS (
  SELECT 1 FROM public.quiz_awards award
  JOIN public.quiz_events event ON event.id=award.event_id AND event.merchant_id=p_merchant_id
  JOIN public.customers customer ON customer.id=award.customer_id AND customer.user_id=p_user_id
  JOIN public.product_offers offer ON offer.id=v_offer_id AND offer.merchant_id=p_merchant_id
    AND offer.product_id=p_product_id AND offer.status='active'
  WHERE award.id=p_award_id AND award.status='approved' AND award.product_id=p_product_id
    AND (award.condition IS NULL OR award.condition=offer.condition)
    AND (nullif(pg_catalog.btrim(p_item->>'condition'),'') IS NULL OR p_item->>'condition'=offer.condition)
 ) THEN
  RAISE EXCEPTION 'quiz_voucher_offer_invalid' USING ERRCODE='22023';
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_serialized_quiz_voucher_offer(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated, service_role;
DO $$
DECLARE
 oid_value oid;
 definition text;
 old text := $old$  IF v_reserved_order_id IS NOT NULL THEN$old$;
 replacement text := $new$  IF v_reserved_order_id IS NOT NULL THEN
    PERFORM private.validate_serialized_quiz_voucher_offer(p_merchant_id,p_user_id,v_award_id,v_product_id,v_voucher_item);$new$;
BEGIN
 SELECT p.oid INTO STRICT oid_value FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='private' AND p.proname='create_storefront_order_with_quiz_voucher' AND p.pronargs=23;
 definition := pg_catalog.pg_get_functiondef(oid_value);
 IF (length(definition)-length(replace(definition,old,'')))/length(old) <> 1 THEN
  RAISE EXCEPTION 'serialized quiz voucher identity source mismatch';
 END IF;
 EXECUTE replace(definition,old,replacement);
END;
$$;
