DO $$
BEGIN
 PERFORM private.create_storefront_order_unchecked('00000000-0000-0000-0000-000000000010',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
 IF NOT EXISTS (SELECT 1 FROM private.serialized_offer_order_items WHERE order_item_id='00000000-0000-0000-0000-000000000006' AND merchant_id='00000000-0000-0000-0000-000000000010' AND offer_id='00000000-0000-0000-0000-000000000003') THEN
   RAISE EXCEPTION 'serialized order creation must persist its trusted offer identity';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000008' AND order_item_id='00000000-0000-0000-0000-000000000006' AND status='reserved') THEN
   RAISE EXCEPTION 'serialized order creation must reserve the matching offer unit';
 END IF;
 IF EXISTS (SELECT 1 FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000007' AND status <> 'available') THEN
   RAISE EXCEPTION 'serialized order creation reserved a different offer';
 END IF;
END $$;
-- A shortage must roll back both the protocol marker and any partial claim.
DELETE FROM private.serialized_offer_order_items;
UPDATE public.variant_inventory SET status='available', order_id=NULL, order_item_id=NULL,
  reserved_at=NULL, first_reserved_at=NULL, reservation_expires_at=NULL WHERE id='00000000-0000-0000-0000-000000000008';
UPDATE public.order_items SET quantity=2 WHERE id='00000000-0000-0000-0000-000000000006';
DO $$
DECLARE failed boolean := false;
BEGIN
 BEGIN
  PERFORM private.create_storefront_order_unchecked('00000000-0000-0000-0000-000000000010',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
 EXCEPTION WHEN object_not_in_prerequisite_state THEN failed := true;
 END;
 IF NOT failed OR EXISTS (SELECT 1 FROM private.serialized_offer_order_items)
   OR EXISTS (SELECT 1 FROM public.variant_inventory WHERE order_item_id='00000000-0000-0000-0000-000000000006') THEN
   RAISE EXCEPTION 'shortage must roll back the marker and partial reservation';
 END IF;
END $$;
-- Quantity-managed offers with tracking off retain the legacy no-claim path.
UPDATE public.products SET inventory_tracking_policy='off' WHERE id='00000000-0000-0000-0000-000000000001';
DO $$
BEGIN
 PERFORM private.create_storefront_order_unchecked('00000000-0000-0000-0000-000000000010',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
 IF EXISTS (SELECT 1 FROM private.serialized_offer_order_items) OR EXISTS (SELECT 1 FROM public.variant_inventory WHERE order_item_id='00000000-0000-0000-0000-000000000006') THEN
   RAISE EXCEPTION 'tracking-off offer must not enter serialized protocol';
 END IF;
END $$;
