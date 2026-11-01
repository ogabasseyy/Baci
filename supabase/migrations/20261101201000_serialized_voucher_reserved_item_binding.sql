-- Bind a reserved voucher's offer to its existing tenant-scoped order item.
DO $$
DECLARE
 definition text := pg_catalog.pg_get_functiondef('private.validate_serialized_quiz_voucher_offer(uuid,uuid,uuid,uuid,jsonb)'::regprocedure);
 old text := $old$  JOIN public.product_offers offer ON offer.id=v_offer_id AND offer.merchant_id=p_merchant_id$old$;
 replacement text := $new$  JOIN public.orders prize_order ON prize_order.id=award.reserved_order_id AND prize_order.merchant_id=p_merchant_id
    AND prize_order.customer_id=award.customer_id
  JOIN public.order_items prize_item ON prize_item.id=award.reserved_order_item_id
    AND prize_item.order_id=prize_order.id AND prize_item.product_id=p_product_id
    AND prize_item.variant_id IS NOT DISTINCT FROM award.variant_id
    AND (award.condition IS NULL OR prize_item.condition=award.condition)
  JOIN public.product_offers offer ON offer.id=v_offer_id AND offer.merchant_id=p_merchant_id$new$;
BEGIN
 IF (length(definition)-length(replace(definition,old,'')))/length(old) <> 1 THEN
  RAISE EXCEPTION 'serialized voucher reserved binding source mismatch';
 END IF;
 EXECUTE replace(definition,old,replacement);
END;
$$;
