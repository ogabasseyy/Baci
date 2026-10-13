SET LOCAL ROLE authenticated;

DO $test$
DECLARE
  v_addon_product_id uuid := '00000000-0000-4000-8000-00000000c203';
  v_customer_id uuid := '00000000-0000-4000-8000-00000000c301';
  v_merchant_id uuid := '00000000-0000-4000-8000-00000000c101';
  v_order_id uuid := '00000000-0000-4000-8000-00000000c402';
  v_owner_user_id uuid := '00000000-0000-4000-8000-00000000c001';
  v_existing_line jsonb := jsonb_build_object(
    'condition', 'new', 'image_url', null,
    'item_description', 'Unreviewed imported snapshot',
    'name', 'Unreviewed imported line', 'price', 50000,
    'product_id', null, 'product_match_status', 'unreviewed',
    'quantity', 1, 'variant_id', null,
    'variant_attributes', '{}'::jsonb, 'variant_name', null
  );
  v_added_line jsonb := jsonb_build_object(
    'condition', null, 'image_url', null, 'item_description', null,
    'name', 'Append after unreviewed line', 'price', 40000,
    'product_id', v_addon_product_id, 'product_match_status', 'linked',
    'quantity', 1, 'variant_id', null,
    'variant_attributes', '{}'::jsonb, 'variant_name', null
  );
  v_payload jsonb;
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_user_id::text, true);

  INSERT INTO public.orders (
    id, merchant_id, customer_id, order_number, customer_name,
    customer_email, customer_phone, shipping_status, payment_status,
    subtotal, shipping_fee, discount_amount, tax_amount,
    gift_wrapping_fee, tax_basis, total, shipping_address, source, notes
  ) VALUES (
    v_order_id, v_merchant_id, v_customer_id, 'ORD-APPEND-UNREVIEWED',
    'Append Buyer', 'append-buyer@example.com', '+2348012345678',
    'pending', 'unpaid', 50000, 2500, 0, 0, 0, 'exclusive', 52500,
    '{"address": "12 Allen Avenue", "name": "Append Buyer", "phone": "+2348012345678", "city": "Ikeja", "state": "Lagos"}'::jsonb,
    'physical', 'Unreviewed append fixture'
  );

  INSERT INTO public.order_items (
    order_id, product_id, variant_id, name, quantity, price, condition,
    item_description, variant_attributes, product_match_status, cost_price
  ) VALUES (
    v_order_id, null, null, 'Unreviewed imported line', 1, 50000, 'new',
    'Unreviewed imported snapshot', '{}'::jsonb, 'unreviewed', 45000
  );

  v_payload := jsonb_build_object(
    'branch_id', null,
    'customer', jsonb_build_object(
      'id', v_customer_id, 'name', 'Append Buyer',
      'email', 'append-buyer@example.com', 'phone', '+2348012345678'
    ),
    'discount_amount', 0, 'gift_wrapping_fee', 0,
    'items', jsonb_build_array(v_existing_line),
    'notify_customer', false,
    'shipping_address', jsonb_build_object(
      'address', '12 Allen Avenue', 'city', 'Ikeja',
      'name', 'Append Buyer', 'phone', '+2348012345678', 'state', 'Lagos'
    ),
    'shipping_fee', 2500, 'source', 'physical', 'tax_amount', 0
  );

  v_result := public.update_admin_order_with_transaction_discount_metadata(
    v_order_id,
    v_payload || jsonb_build_object(
      'items', jsonb_build_array(v_existing_line, v_added_line)
    )
  );

  IF (v_result ->> 'change_category') IS DISTINCT FROM 'financial' THEN
    RAISE EXCEPTION 'unreviewed append did not report a financial change: %', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.order_items
    WHERE order_id = v_order_id AND product_id IS NULL
      AND product_match_status = 'unreviewed' AND cost_price = 45000
  ) THEN
    RAISE EXCEPTION 'append changed the unreviewed accounting snapshot';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.order_items
    WHERE order_id = v_order_id AND product_id = v_addon_product_id
  ) THEN
    RAISE EXCEPTION 'append did not add the line after an unreviewed snapshot';
  END IF;
END;
$test$ LANGUAGE plpgsql;

RESET ROLE;
