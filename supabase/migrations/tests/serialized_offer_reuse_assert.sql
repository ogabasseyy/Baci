-- A protocol-marked offer must claim only its own units during reuse.
INSERT INTO private.serialized_offer_order_items VALUES ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000003');
DO $$ BEGIN
 PERFORM private.prepare_storefront_order_for_checkout('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000010','token','buyer@example.com','card');
 IF (SELECT fulfillment_data->>'refundReference' FROM public.order_items WHERE id='00000000-0000-0000-0000-000000000006') IS DISTINCT FROM 'keep-me' THEN RAISE EXCEPTION 'reuse erased refund metadata'; END IF;
 IF (SELECT condition_offer_id FROM public.variant_inventory WHERE order_item_id='00000000-0000-0000-0000-000000000006') IS DISTINCT FROM '00000000-0000-0000-0000-000000000003'::uuid THEN
  RAISE EXCEPTION 'reuse did not claim matching offer unit';
 END IF;
END $$;
-- A repeat refreshes the same reservation; a corrupted marker must fail closed.
DO $$ BEGIN
 PERFORM private.prepare_storefront_order_for_checkout('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000010','token','buyer@example.com','card');
 IF (SELECT count(*) FROM public.variant_inventory WHERE order_item_id='00000000-0000-0000-0000-000000000006') <> 1 THEN RAISE EXCEPTION 'reuse duplicated reservation'; END IF;
 UPDATE private.serialized_offer_order_items SET merchant_id='00000000-0000-0000-0000-000000000099' WHERE order_item_id='00000000-0000-0000-0000-000000000006';
 BEGIN
  PERFORM private.prepare_storefront_order_for_checkout('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000010','token','buyer@example.com','card');
  RAISE EXCEPTION 'wrong-merchant protocol marker was accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF (SELECT status FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000008') <> 'reserved' THEN RAISE EXCEPTION 'corrupted marker released a unit'; END IF;
 UPDATE private.serialized_offer_order_items SET merchant_id='00000000-0000-0000-0000-000000000010' WHERE order_item_id='00000000-0000-0000-0000-000000000006';
END $$;
-- Legacy offer lines still release stale reservations.
DELETE FROM private.serialized_offer_order_items WHERE order_item_id='00000000-0000-0000-0000-000000000006';
DO $$ BEGIN
 PERFORM private.prepare_storefront_order_for_checkout('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000010','token','buyer@example.com','card');
 IF EXISTS (SELECT 1 FROM public.variant_inventory WHERE order_item_id='00000000-0000-0000-0000-000000000006') THEN RAISE EXCEPTION 'legacy reservation not released'; END IF;
END $$;
