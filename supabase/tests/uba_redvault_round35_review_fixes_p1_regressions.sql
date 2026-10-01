-- Round-35 P1 regressions: removing the obsolete order_items surviving
-- quantity trigger preserves the quantity-managed fulfillment count a
-- partial refund release writes, instead of overwriting it with the
-- (empty) reserved unit count.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '8d7edac6-7797-578e-c258-af7fc52fd972';
  v_customer uuid := '55555555-0000-4000-8000-0000000000e1';
  v_product uuid := 'b1000000-0000-4000-8000-0000000000e1';
  v_order uuid := '31000000-0000-4000-8000-0000000000e1';
  v_item uuid := '32000000-0000-4000-8000-0000000000e1';
  v_surviving text;
  v_trigger_count integer;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p35@example.com', 'Redvault P35')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.products (id, merchant_id, name, price, has_variants, inventory_tracking_policy,
    manage_stock, stock_quantity)
  VALUES (v_product, v_merchant, 'Redvault P35 qty', 75000, false, 'simple', true, 10);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer, v_merchant, NULL, 'redvault-p35@example.com');
  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, total, payment_method, payment_status, shipping_status,
     tracking_token, created_at)
  VALUES (v_order, v_merchant, v_customer, 'R35P1-QTY', 1500.00, 'uba_redvault', 'paid', 'pending',
    'track-r35-qty', pg_catalog.now() - interval '10 minutes');
  INSERT INTO public.order_items (id, order_id, product_id, name, price, quantity, fulfillment_data)
  VALUES (v_item, v_order, v_product, 'Redvault P35 item', 75000, 3, '{}'::jsonb);
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- P1 (quantity-managed fulfillment): the obsolete order_items trigger
  -- is gone, and a surviving-count write like the partial-refund
  -- quantity release performs persists instead of resetting to the
  -- reserved unit count (zero for quantity-managed lines).
  SELECT count(*) INTO v_trigger_count
  FROM pg_catalog.pg_trigger AS trigger_row
  JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_row.tgrelid
  WHERE trigger_row.tgname = 'persist_redvault_surviving_shipment_quantity'
    AND relation.relname = 'order_items';
  IF v_trigger_count <> 0 THEN
    RAISE EXCEPTION 'obsolete order_items surviving-quantity trigger still installed';
  END IF;
  UPDATE public.order_items
  SET fulfillment_data = COALESCE(fulfillment_data, '{}'::jsonb)
    || jsonb_build_object('fulfillmentQuantity', 2)
  WHERE id = v_item;
  SELECT fulfillment_data->>'fulfillmentQuantity' INTO v_surviving
  FROM public.order_items WHERE id = v_item;
  IF v_surviving <> '2' THEN
    RAISE EXCEPTION 'surviving fulfillmentQuantity overwritten to %, want 2', v_surviving;
  END IF;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
