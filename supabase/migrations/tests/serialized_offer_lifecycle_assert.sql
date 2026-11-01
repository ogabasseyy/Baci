SELECT public.assign_variant_inventory_unit_offer('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003');
SELECT private.claim_variant_inventory_units_for_order_item_internal('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000009');
DELETE FROM public.product_offers WHERE id='00000000-0000-0000-0000-000000000003';
-- The real order-item FKs use ON DELETE SET NULL and retain the snapshot.
UPDATE public.order_items SET product_offer_id=NULL, offer_id=NULL WHERE id='00000000-0000-0000-0000-000000000009';
SELECT private.claim_variant_inventory_units_for_order_item_internal('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000009');
DO $$ BEGIN
 IF (SELECT condition_offer_id FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000004') IS DISTINCT FROM '00000000-0000-0000-0000-000000000003'::uuid THEN RAISE EXCEPTION 'replay lost deleted offer identity'; END IF;
END $$;
UPDATE public.orders SET payment_status='paid' WHERE id='00000000-0000-0000-0000-000000000008';
DO $$ DECLARE result jsonb; BEGIN
 result := private.confirm_order_inventory_reservations('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000008');
 IF (result->>'missingUnitCount')::integer <> 0 OR (SELECT reservation_expires_at FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000004') IS NOT NULL THEN RAISE EXCEPTION 'deleted-offer reservation was not confirmed'; END IF;
END $$;
UPDATE public.variant_inventory SET status='available',order_id=NULL,order_item_id=NULL WHERE id='00000000-0000-0000-0000-000000000004';
DO $$ BEGIN
 IF (SELECT condition_offer_id FROM public.variant_inventory WHERE id='00000000-0000-0000-0000-000000000004') IS NOT NULL THEN RAISE EXCEPTION 'released unit retained deleted offer'; END IF;
 BEGIN
  PERFORM private.claim_variant_inventory_units_for_order_item_internal('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000009');
  RAISE EXCEPTION 'deleted offer was reclaimed';
 EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $$;
