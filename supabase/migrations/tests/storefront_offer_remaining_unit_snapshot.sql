-- Mixed-status repair must preserve evidence for remaining attachments.
-- Scope: pre-marker rows without any surviving offer identity remain plain;
-- catalog conditions cannot safely reconstruct deleted historical offers.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$
#variable_conflict use_variable
DECLARE
  merchant_id uuid := '03e00000-0000-4000-8000-000000000001';
  product_id uuid := '03e00000-0000-4000-8000-000000000002';
  offer_id uuid := '03e00000-0000-4000-8000-000000000003';
  anchor_id uuid := '03e00000-0000-4000-8000-000000000004';
  reserved_id uuid := '03e00000-0000-4000-8000-000000000005';
  sold_id uuid := '03e00000-0000-4000-8000-000000000006';
  order_id uuid;
  item_id uuid;
  tracking_token text;
  snapshot jsonb;
  released integer;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug, is_published)
  VALUES (merchant_id, 'remaining-unit@example.com', 'Remaining unit', 'remaining-unit', true);
  INSERT INTO public.products (id, merchant_id, name, price, status,
    condition, stock_quantity, manage_stock, has_condition_offers,
    has_variants, inventory_tracking_policy)
  VALUES (product_id, merchant_id, 'Remaining unit phone', 500000,
    'active', 'new', 5, false, true, false, 'serialized_strict');
  INSERT INTO public.product_variants (id, product_id, merchant_id, attributes,
    price_override, inventory_tracking_policy, is_inventory_anchor)
  VALUES (anchor_id, product_id, merchant_id, '{"is_anchor":true}', 0, 'inherit', true);
  UPDATE public.products p SET inventory_anchor_variant_id = anchor_id WHERE p.id = product_id;
  INSERT INTO public.product_offers (id, product_id, merchant_id, condition, price,
    stock_quantity, status)
  VALUES (offer_id, product_id, merchant_id, 'used', 400000, 5, 'active');
  SELECT o.id, o.tracking_token INTO order_id, tracking_token
  FROM public.create_storefront_order(
    p_merchant_id => merchant_id,
    p_customer_email => 'remaining-unit-buyer@example.com',
    p_customer_name => 'Remaining Unit Buyer',
    p_items => jsonb_build_array(jsonb_build_object(
      'product_id', product_id, 'offer_id', offer_id, 'quantity', 1
    ))
  ) o;
  SELECT oi.id INTO STRICT item_id FROM public.order_items oi WHERE oi.order_id = order_id;

  INSERT INTO public.variant_inventory (id, variant_id, merchant_id,
    identifier_type, identifier_value, status, order_id, order_item_id,
    reserved_at, first_reserved_at, reservation_expires_at)
  VALUES (reserved_id, anchor_id, merchant_id, 'imei', '933740000000001',
    'reserved', order_id, item_id, now(), now(), now() + interval '1 hour'),
    (sold_id, anchor_id, merchant_id, 'imei', '933740000000002',
    'sold', order_id, item_id, NULL, now(), NULL);
  snapshot := jsonb_build_object('source', 'merchant_stock', 'fulfillmentQuantity', 1,
    'inventoryUnits', jsonb_build_array(jsonb_build_object(
      'inventoryUnitId', sold_id, 'identifierType', 'imei', 'identifierValue', '933740000000002'
    )), 'missingUnitCount', 0);
  UPDATE public.order_items oi SET fulfillment_data = snapshot WHERE oi.id = item_id;
  PERFORM private.prepare_storefront_order_for_checkout(
    p_order_id => order_id, p_merchant_id => merchant_id,
    p_tracking_token => tracking_token, p_customer_email => 'remaining-unit-buyer@example.com',
    p_payment_method => 'card'
  );
  IF NOT EXISTS (SELECT 1 FROM public.variant_inventory vi
      WHERE vi.id = reserved_id AND vi.status = 'available' AND vi.order_item_id IS NULL) THEN
    RAISE EXCEPTION 'mixed-status repair did not release its reserved unit';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.variant_inventory vi
      WHERE vi.id = sold_id AND vi.status = 'sold' AND vi.order_item_id = item_id) THEN
    RAISE EXCEPTION 'mixed-status repair modified sold attachment';
  END IF;
  IF (SELECT oi.fulfillment_data FROM public.order_items oi WHERE oi.id = item_id)
      IS DISTINCT FROM snapshot
     OR (SELECT o.fulfillment_details FROM public.orders o WHERE o.id = order_id)
      IS DISTINCT FROM snapshot THEN
    RAISE EXCEPTION 'mixed-status repair discarded remaining sold assignment snapshot';
  END IF;
  -- Repeat through confirmation with a fresh reserved hold beside the sold unit.
  UPDATE public.variant_inventory vi SET status = 'reserved', order_id = order_id,
    order_item_id = item_id, reserved_at = now(), reservation_expires_at = NULL
  WHERE vi.id = reserved_id;
  UPDATE public.orders o SET payment_status = 'paid' WHERE o.id = order_id;
  PERFORM public.confirm_order_inventory_reservations(merchant_id, order_id);
  IF (SELECT oi.fulfillment_data FROM public.order_items oi WHERE oi.id = item_id)
      IS DISTINCT FROM snapshot THEN
    RAISE EXCEPTION 'confirmation discarded remaining sold assignment snapshot';
  END IF;
  SELECT count(*) INTO released FROM private.variant_inventory_events e
  WHERE e.inventory_unit_id = reserved_id AND e.event_type = 'reservation_released';
  IF released <> 2 THEN RAISE EXCEPTION 'expected two release events, got %', released; END IF;

  -- Zero released units: the last attachment was detached elsewhere, while a
  -- nonempty stale snapshot remains. Strip only unit keys; preserve refund data.
  UPDATE public.variant_inventory vi SET status = 'available', order_id = NULL,
    order_item_id = NULL WHERE vi.id = sold_id;
  PERFORM public.confirm_order_inventory_reservations(merchant_id, order_id);
  IF (SELECT oi.fulfillment_data FROM public.order_items oi WHERE oi.id = item_id)
      IS DISTINCT FROM '{"source":"merchant_stock","fulfillmentQuantity":1}'::jsonb THEN
    RAISE EXCEPTION 'zero-release stale snapshot was not stripped while preserving other fields';
  END IF;
  IF (SELECT count(*) FROM private.variant_inventory_events e
      WHERE e.inventory_unit_id = reserved_id AND e.event_type = 'reservation_released') <> released THEN
    RAISE EXCEPTION 'zero-release confirmation unexpectedly released another unit';
  END IF;
  -- Explicit boundary: without a surviving identity or the 09330000 marker,
  -- a plain condition line must still claim units even if a live offer shares
  -- its condition. This is also the ambiguous pre-marker/deleted-FK shape;
  -- no safe automatic classification of that historic cohort is asserted.
  SELECT o.id, o.tracking_token INTO order_id, tracking_token
  FROM public.create_storefront_order(
    p_merchant_id => merchant_id,
    p_customer_email => 'remaining-unit-buyer@example.com',
    p_customer_name => 'Remaining Unit Buyer',
    p_items => jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1))
  ) o;
  SELECT oi.id INTO STRICT item_id FROM public.order_items oi WHERE oi.order_id = order_id;
  ALTER TABLE public.order_items DISABLE TRIGGER order_items_offer_id_snapshot_guard;
  UPDATE public.order_items oi SET condition = 'used', offer_line = false,
    offer_labels_snapshotted = false, offer_id = NULL, product_offer_id = NULL
  WHERE oi.id = item_id;
  ALTER TABLE public.order_items ENABLE TRIGGER order_items_offer_id_snapshot_guard;
  PERFORM private.prepare_storefront_order_for_checkout(
    p_order_id => order_id, p_merchant_id => merchant_id,
    p_tracking_token => tracking_token, p_customer_email => 'remaining-unit-buyer@example.com',
    p_payment_method => 'card'
  );
  UPDATE public.orders o SET payment_status = 'paid' WHERE o.id = order_id;
  PERFORM public.confirm_order_inventory_reservations(merchant_id, order_id);
  IF (SELECT count(*) FROM public.variant_inventory vi
      WHERE vi.order_item_id = item_id AND vi.status <> 'available') <> 1 THEN
    RAISE EXCEPTION 'ambiguous marker-free condition line lost its legitimate serialized claim';
  END IF;
END;
$$;
ROLLBACK;
