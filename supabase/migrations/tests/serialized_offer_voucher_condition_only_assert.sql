DO $$ BEGIN
 PERFORM * FROM private.create_storefront_order_with_quiz_voucher(
  p_merchant_id=>'00000000-0000-0000-0000-000000000002', p_customer_email=>'buyer@example.com',p_customer_name=>'Buyer',
  p_items=>'[{"voucher_award_id":"00000000-0000-0000-0000-000000000008","product_id":"00000000-0000-0000-0000-000000000007","condition":"used"}]',
  p_user_id=>'00000000-0000-0000-0000-000000000004');
 IF NOT EXISTS (
  SELECT 1 FROM public.quiz_awards award
  JOIN private.serialized_offer_order_items marker ON marker.order_item_id=award.reserved_order_item_id
  JOIN public.variant_inventory unit ON unit.order_item_id=marker.order_item_id
  WHERE award.id='00000000-0000-0000-0000-000000000008'
    AND award.status='claimed' AND marker.merchant_id='00000000-0000-0000-0000-000000000002'
    AND marker.offer_id='00000000-0000-0000-0000-000000000011'
    AND unit.id='00000000-0000-0000-0000-000000000010' AND unit.status='reserved'
    AND unit.order_id=award.reserved_order_id
 ) OR NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000009' AND status='available' AND order_id IS NULL AND order_item_id IS NULL)
 OR NOT EXISTS (SELECT 1 FROM public.quiz_prize_reservations WHERE id='00000000-0000-0000-0000-000000000013' AND state='transferred' AND inventory_unit_id='00000000-0000-0000-0000-000000000009' AND award_id='00000000-0000-0000-0000-000000000008')
 OR NOT EXISTS (SELECT 1 FROM public.orders o JOIN public.quiz_awards award ON award.reserved_order_id=o.id JOIN public.order_items item ON item.id=award.reserved_order_item_id WHERE award.id='00000000-0000-0000-0000-000000000008' AND o.fulfillment_details->'inventoryUnits' = item.fulfillment_data->'inventoryUnits' AND o.fulfillment_details->'inventoryUnits' @> '[{"inventoryUnitId":"00000000-0000-0000-0000-000000000010"}]'::jsonb AND NOT o.fulfillment_details->'inventoryUnits' @> '[{"inventoryUnitId":"00000000-0000-0000-0000-000000000009"}]'::jsonb)
 OR (SELECT stock_quantity FROM public.product_offers WHERE id='00000000-0000-0000-0000-000000000011') <> 4
 OR (SELECT count(*) FROM private.variant_inventory_events WHERE event_type='reservation_released' AND inventory_unit_id='00000000-0000-0000-0000-000000000009') <> 1
 OR (SELECT count(*) FROM private.variant_inventory_events WHERE event_type='reserved' AND inventory_unit_id='00000000-0000-0000-0000-000000000010') <> 1
 OR (SELECT count(*) FROM public.variant_inventory WHERE order_id='00000000-0000-0000-0000-000000000005' AND status='reserved') <> 1 THEN
  RAISE EXCEPTION 'condition-only voucher checkout must bind exactly the selected offer unit and release the original hold';
 END IF;
END $$;
