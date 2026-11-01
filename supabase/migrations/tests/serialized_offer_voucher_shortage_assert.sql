-- Failure to find the chosen offer must leave the prize and its hold intact.
UPDATE public.variant_inventory SET status='sold' WHERE id='00000000-0000-0000-0000-000000000010';
DO $$
DECLARE rejected boolean := false;
BEGIN
 BEGIN
  PERFORM * FROM private.create_storefront_order_with_quiz_voucher(
   p_merchant_id=>'00000000-0000-0000-0000-000000000002', p_customer_email=>'buyer@example.com', p_customer_name=>'Buyer',
   p_items=>'[{"voucher_award_id":"00000000-0000-0000-0000-000000000008","product_id":"00000000-0000-0000-0000-000000000007","offer_id":"00000000-0000-0000-0000-000000000011","condition":"used"}]',
   p_user_id=>'00000000-0000-0000-0000-000000000004');
 EXCEPTION WHEN object_not_in_prerequisite_state THEN rejected := true;
 END;
 IF NOT rejected OR NOT EXISTS (SELECT 1 FROM public.quiz_awards WHERE id='00000000-0000-0000-0000-000000000008' AND status='approved' AND reserved_order_item_id='00000000-0000-0000-0000-000000000006')
 OR NOT EXISTS (SELECT 1 FROM public.quiz_prize_reservations WHERE id='00000000-0000-0000-0000-000000000013' AND state='transferred' AND inventory_unit_id='00000000-0000-0000-0000-000000000009' AND award_id='00000000-0000-0000-0000-000000000008')
  OR NOT EXISTS (SELECT 1 FROM public.orders o JOIN public.order_items item ON item.order_id=o.id WHERE o.id='00000000-0000-0000-0000-000000000005' AND o.fulfillment_details->'inventoryUnits' = item.fulfillment_data->'inventoryUnits' AND o.fulfillment_details->'inventoryUnits' @> '[{"inventoryUnitId":"00000000-0000-0000-0000-000000000009"}]'::jsonb)
  OR (SELECT stock_quantity FROM public.product_offers WHERE id='00000000-0000-0000-0000-000000000011') <> 5
  OR EXISTS (SELECT 1 FROM private.quiz_offer_transition_context)
  OR EXISTS (SELECT 1 FROM private.variant_inventory_events)
  OR NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000009' AND status='reserved' AND order_item_id='00000000-0000-0000-0000-000000000006') THEN
  RAISE EXCEPTION 'voucher shortage must reject and preserve the original award and hold';
 END IF;
END $$;
