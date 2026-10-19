SET LOCAL ROLE authenticated;

DO $test$
DECLARE
  v_addon_product_id uuid := '00000000-0000-4000-8000-00000000c203';
  v_addon_variant_id uuid := '00000000-0000-4000-8000-00000000c204';
  v_customer_id uuid := '00000000-0000-4000-8000-00000000c301';
  v_merchant_id uuid := '00000000-0000-4000-8000-00000000c101';
  v_order_id uuid := '00000000-0000-4000-8000-00000000c401';
  v_owner_user_id uuid := '00000000-0000-4000-8000-00000000c001';
  v_product_id uuid := '00000000-0000-4000-8000-00000000c201';
  v_existing_item_id uuid;
  v_existing_line jsonb;
  v_existing_line_modified jsonb;
  v_addon_line jsonb;
  v_custom_line_a jsonb;
  v_custom_line_b jsonb;
  v_empty_product_line jsonb;
  v_payload jsonb;
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_user_id::text, true);

  UPDATE public.order_items
  SET cost_price = 700000
  WHERE order_id = v_order_id;

  SELECT id
  INTO v_existing_item_id
  FROM public.order_items
  WHERE order_id = v_order_id
    AND product_id = v_product_id;

  v_existing_line := jsonb_build_object(
    'condition', 'new',
    'image_url', 'https://cdn.example.test/append-phone.jpg',
    'item_description', 'Protected accounting snapshot',
    'name', 'Append Protected Phone',
    'price', 1000000,
    'product_id', v_product_id,
    'product_match_status', 'linked',
    'quantity', 1,
    'variant_id', '00000000-0000-4000-8000-00000000c202'::uuid,
    'variant_attributes', '{"color": "Black", "storage": "512GB"}'::jsonb,
    'variant_name', 'Black / 512GB'
  );

  v_addon_line := jsonb_build_object(
    'condition', null,
    'image_url', 'https://cdn.example.test/append-usb-c.jpg',
    'item_description', 'Apple USB-C power adapter',
    'name', 'Append USB-C Power Adapter',
    'price', 40000,
    'product_id', v_addon_product_id,
    'product_match_status', 'linked',
    'quantity', 1,
    'variant_id', v_addon_variant_id,
    'variant_attributes', '{"wattage": "61W"}'::jsonb,
    'variant_name', '61W'
  );

  v_existing_line_modified := jsonb_set(
    v_existing_line,
    '{quantity}',
    '2'::jsonb
  );

  v_custom_line_a := jsonb_build_object(
    'condition', null,
    'image_url', null,
    'item_description', null,
    'name', 'Custom Append A',
    'price', 1000,
    'product_id', null,
    'product_match_status', 'custom',
    'quantity', 1,
    'variant_id', null,
    'variant_attributes', '{}'::jsonb,
    'variant_name', null
  );

  v_custom_line_b := jsonb_build_object(
    'condition', null,
    'image_url', null,
    'item_description', null,
    'name', 'Custom Append B',
    'price', 2000,
    'product_id', null,
    'product_match_status', 'custom',
    'quantity', 1,
    'variant_id', null,
    'variant_attributes', '{}'::jsonb,
    'variant_name', null
  );

  v_empty_product_line := jsonb_build_object(
    'condition', null,
    'image_url', null,
    'item_description', null,
    'name', 'Empty product id custom line',
    'price', 1000,
    'product_id', '',
    'product_match_status', 'custom',
    'quantity', 1,
    'variant_id', null,
    'variant_attributes', '{}'::jsonb,
    'variant_name', null
  );

  v_payload := jsonb_build_object(
    'branch_id', null,
    'customer', jsonb_build_object(
      'id', v_customer_id,
      'name', 'Append Buyer',
      'email', 'append-buyer@example.com',
      'phone', '+2348012345678'
    ),
    'discount_amount', 0,
    'gift_wrapping_fee', 0,
    'notes', 'Append fixture order',
    'notify_customer', false,
    'shipping_address', jsonb_build_object(
      'address', '12 Allen Avenue',
      'city', 'Ikeja',
      'name', 'Append Buyer',
      'phone', '+2348012345678',
      'state', 'Lagos'
    ),
    'shipping_fee', 2500,
    'source', 'physical',
    'tax_amount', 1250
  );

  v_result := public.update_admin_order_with_transaction_discount_metadata(
    v_order_id,
    v_payload || jsonb_build_object(
      'items', jsonb_build_array(v_existing_line, v_addon_line)
    )
  );

  IF (v_result ->> 'change_category') IS DISTINCT FROM 'financial'
    OR ((v_result -> 'changed_fields') ? 'items') IS NOT TRUE
  THEN
    RAISE EXCEPTION 'append did not report a financial item change: %', v_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.order_items
    WHERE id = v_existing_item_id
      AND cost_price = 700000
  ) THEN
    RAISE EXCEPTION 'append replaced the protected accounting row';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.order_items
    WHERE order_id = v_order_id
      AND product_id = v_addon_product_id
      AND variant_id = v_addon_variant_id
      AND condition IS NULL
  ) THEN
    RAISE EXCEPTION 'append did not preserve the add-on condition snapshot';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.orders
    WHERE id = v_order_id
      AND tax_amount = 1250
      AND tax_exclusive_amount = 1040000
      AND tax_inclusive_amount = 1041250
      AND total = 1043750
  ) THEN
    RAISE EXCEPTION 'append did not preserve the requested manual tax amount';
  END IF;

  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(
      v_order_id,
      v_payload || jsonb_build_object(
        'items', jsonb_build_array(v_existing_line)
      )
    );
    RAISE EXCEPTION 'protected line removal unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%order_item_replacement_has_accounting_metadata%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(
      v_order_id,
      v_payload || jsonb_build_object(
        'items', jsonb_build_array(v_existing_line_modified, v_addon_line)
      )
    );
    RAISE EXCEPTION 'protected line modification unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%order_item_replacement_has_accounting_metadata%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(
      v_order_id,
      v_payload || jsonb_build_object(
        'items', jsonb_build_array(
          v_existing_line,
          v_addon_line,
          v_custom_line_a,
          v_custom_line_b
        )
      )
    );
    RAISE EXCEPTION 'two-line append unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%order_item_append_supports_one_new_line%' THEN
      RAISE;
    END IF;
  END;

  UPDATE public.merchants
  SET vat_registration_status = 'registered'
  WHERE id = v_merchant_id;

  INSERT INTO public.order_tax_subtotals (
    order_id, vat_category_code, vat_rate, taxable_amount, tax_amount,
    exemption_reason, exemption_reason_code
  ) VALUES (v_order_id, 'Z', 0, 40000, 0, 'Zero-rated supply', 'VAT-ZERO-RATED');

  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(
      v_order_id,
      v_payload || jsonb_build_object(
        'items', jsonb_build_array(
          v_existing_line,
          v_addon_line,
          v_empty_product_line
        )
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'empty product id append unexpectedly failed: %', SQLERRM;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM public.order_items
    WHERE order_id = v_order_id
      AND product_id IS NULL
      AND product_match_status = 'custom'
      AND condition IS NULL
      AND name = 'Empty product id custom line'
  ) THEN
    RAISE EXCEPTION 'empty product id custom append did not persist';
  END IF;

  IF (
    SELECT COALESCE(SUM(tax_amount), 0)
    FROM public.order_tax_subtotals
    WHERE order_id = v_order_id
  ) IS DISTINCT FROM 1250 THEN
    RAISE EXCEPTION 'registered append tax subtotals did not reconcile to requested tax';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.order_tax_subtotals
    WHERE order_id = v_order_id
      AND vat_category_code = 'S'
      AND vat_rate = 7.5
      AND tax_amount = 1250
  ) THEN
    RAISE EXCEPTION 'registered append allocated tax outside the standard VAT group';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.order_tax_subtotals
    WHERE order_id = v_order_id
      AND vat_category_code = 'Z'
      AND vat_rate = 0
      AND tax_amount = 0
      AND exemption_reason = 'Zero-rated supply'
      AND exemption_reason_code = 'VAT-ZERO-RATED'
  ) THEN
    RAISE EXCEPTION 'registered append did not preserve zero-rated subtotal metadata';
  END IF;
END;
$test$ LANGUAGE plpgsql;

RESET ROLE;

\ir 003_negative_scenarios.sql
\ir 004_metadata_and_tax_scenarios.sql
