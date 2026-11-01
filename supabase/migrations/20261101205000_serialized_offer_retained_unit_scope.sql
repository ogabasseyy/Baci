-- A retained deleted-offer unit must belong to this merchant and order.
DO $$
DECLARE
 definition text := pg_catalog.pg_get_functiondef('private.claim_variant_inventory_units_for_order_item_internal(uuid,uuid,uuid)'::regprocedure);
 old text := $old$      WHERE vi.order_item_id = p_order_item_id AND vi.condition_offer_id = v_condition_offer_id$old$;
 replacement text := $new$      WHERE vi.order_item_id = p_order_item_id AND vi.condition_offer_id = v_condition_offer_id
        AND vi.order_id = p_order_id AND vi.merchant_id = p_merchant_id
        AND vi.status IN ('reserved', 'sold')$new$;
BEGIN
 IF (length(definition)-length(replace(definition,old,'')))/length(old) <> 1 THEN
  RAISE EXCEPTION 'serialized retained unit scope source mismatch';
 END IF;
 definition := replace(definition,old,replacement);
 old := $old$  IF v_condition_offer_id IS NOT NULL AND v_product_offer_id IS NULL AND v_exact_offer_id IS NULL$old$;
 replacement := $new$  IF v_condition_offer_id IS NOT NULL AND v_product_offer_id IS NULL AND v_exact_offer_id IS NULL
    AND EXISTS (SELECT 1 FROM public.variant_inventory vi WHERE vi.order_item_id = p_order_item_id
      AND (vi.order_id IS DISTINCT FROM p_order_id OR vi.merchant_id IS DISTINCT FROM p_merchant_id
        OR vi.status NOT IN ('reserved', 'sold'))) THEN
    RAISE EXCEPTION 'serialized_offer_reservation_mismatch' USING ERRCODE = '55000';
  END IF;
  IF v_condition_offer_id IS NOT NULL AND v_product_offer_id IS NULL AND v_exact_offer_id IS NULL$new$;
 IF (length(definition)-length(replace(definition,old,'')))/length(old) <> 1 THEN
  RAISE EXCEPTION 'serialized retained unit consistency source mismatch';
 END IF;
 EXECUTE replace(definition,old,replacement);
END;
$$;
