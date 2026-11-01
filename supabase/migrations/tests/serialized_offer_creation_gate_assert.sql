-- Until the feature gate opens, offer-ID-only legacy orders must not claim
-- serialized inventory or enter the new protocol.
SELECT set_config('test.serialized_offer_gate','off',false);
DO $$ BEGIN
 PERFORM private.create_storefront_order_unchecked('00000000-0000-0000-0000-000000000010',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
 IF EXISTS (SELECT 1 FROM private.serialized_offer_order_items) OR EXISTS (SELECT 1 FROM public.variant_inventory WHERE order_item_id='00000000-0000-0000-0000-000000000006') THEN
  RAISE EXCEPTION 'closed serialized offer gate must preserve legacy order behavior';
 END IF;
END $$;
