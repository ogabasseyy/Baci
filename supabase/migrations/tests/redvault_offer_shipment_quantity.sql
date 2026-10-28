-- REDVAULT stale-hold cleanup must preserve offer shipment quantities.
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
BEGIN
  -- Match protected REDVAULT writers; owner privileges do not bypass the guard.
  INSERT INTO private.uba_redvault_write_context (transaction_id)
  VALUES (pg_catalog.txid_current()) ON CONFLICT DO NOTHING;
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

  UPDATE public.orders o SET payment_method = 'uba_redvault' WHERE o.id = order_id;
  INSERT INTO public.variant_inventory (id, variant_id, merchant_id,
    identifier_type, identifier_value, status, order_id, order_item_id,
    reserved_at, first_reserved_at, reservation_expires_at)
  VALUES (reserved_id, anchor_id, merchant_id, 'imei', '933740000000099',
    'reserved', order_id, item_id, now(), now(), NULL);
  snapshot := jsonb_build_object('source', 'merchant_stock', 'fulfillmentQuantity', 1,
    'refund', true, 'inventoryUnits', jsonb_build_array(jsonb_build_object(
      'inventoryUnitId', reserved_id)), 'missingUnitCount', 0);
  UPDATE public.order_items oi SET fulfillment_data = snapshot WHERE oi.id = item_id;
  PERFORM private.release_stale_offer_line_serialized_units(
    merchant_id, order_id, item_id, product_id, '{}'::jsonb);
  IF NOT EXISTS (SELECT 1 FROM public.variant_inventory vi WHERE vi.id = reserved_id
      AND vi.status = 'available' AND vi.order_item_id IS NULL) THEN
    RAISE EXCEPTION 'REDVAULT offer cleanup did not release stale hold';
  END IF;
  IF (SELECT oi.fulfillment_data FROM public.order_items oi WHERE oi.id = item_id)
      IS DISTINCT FROM '{"source":"merchant_stock","fulfillmentQuantity":1,"refund":true}'::jsonb THEN
    RAISE EXCEPTION 'REDVAULT offer cleanup lost purchased quantity or refund metadata';
  END IF;
  -- A genuine serialized line must retain the original trigger behavior.
  SELECT o.id INTO order_id FROM public.create_storefront_order(
    p_merchant_id => merchant_id,
    p_customer_email => 'serialized-redvault@example.com',
    p_customer_name => 'Serialized REDVAULT',
    p_items => jsonb_build_array(jsonb_build_object('product_id', product_id, 'quantity', 1))
  ) o;
  SELECT oi.id INTO STRICT item_id FROM public.order_items oi WHERE oi.order_id = order_id;
  UPDATE public.orders o SET payment_method = 'uba_redvault' WHERE o.id = order_id;
  UPDATE public.variant_inventory vi SET status = 'reserved', order_id = order_id,
    order_item_id = item_id, reserved_at = now() WHERE vi.id = reserved_id;
  UPDATE public.variant_inventory vi SET status = 'available', order_id = NULL,
    order_item_id = NULL, reserved_at = NULL WHERE vi.id = reserved_id;
  IF (SELECT oi.fulfillment_data->'fulfillmentQuantity' FROM public.order_items oi WHERE oi.id = item_id)
      IS DISTINCT FROM '0'::jsonb THEN
    RAISE EXCEPTION 'REDVAULT serialized line no longer tracks remaining reserved units';
  END IF;
END;
$$;
ROLLBACK;
