SET LOCAL ROLE authenticated;

DO $test$
DECLARE
  v_addon_product_id uuid := '00000000-0000-4000-8000-00000000c203';
  v_addon_variant_id uuid := '00000000-0000-4000-8000-00000000c204';
  v_branch_id uuid := '00000000-0000-4000-8000-00000000d803';
  v_customer_id uuid := '00000000-0000-4000-8000-00000000c301';
  v_merchant_id uuid := '00000000-0000-4000-8000-00000000c101';
  v_order_id uuid := '00000000-0000-4000-8000-00000000c401';
  v_owner_user_id uuid := '00000000-0000-4000-8000-00000000c001';
  v_product_id uuid := '00000000-0000-4000-8000-00000000c201';
  v_existing_items jsonb;
  v_explicit_null_line jsonb := jsonb_build_object(
    'condition', null, 'image_url', null, 'item_description', null,
    'name', 'Explicit Null Metadata Custom Line', 'price', 1000,
    'product_id', null, 'product_match_status', 'custom', 'quantity', 1,
    'variant_id', null, 'variant_attributes', '{}'::jsonb, 'variant_name', null
  );
  v_payload jsonb;
  v_omitted_payload jsonb;
  v_new_line jsonb := jsonb_build_object(
    'condition', null, 'image_url', null, 'item_description', null,
    'name', 'Negative Scenario Custom Line', 'price', 1000, 'product_id', null,
    'product_match_status', 'custom', 'quantity', 1, 'variant_id', null,
    'variant_attributes', '{}'::jsonb, 'variant_name', null
  );
  v_omitted_line jsonb := jsonb_build_object(
    'condition', null, 'image_url', null, 'item_description', null,
    'name', 'Omitted Metadata Custom Line', 'price', 1000, 'product_id', null,
    'product_match_status', 'custom', 'quantity', 1, 'variant_id', null,
    'variant_attributes', '{}'::jsonb, 'variant_name', null
  );
  v_zero_tax_line jsonb := jsonb_build_object(
    'condition', null, 'image_url', null, 'item_description', null,
    'name', 'Zero Tax USB-C Adapter Line', 'price', 1000,
    'product_id', v_addon_product_id, 'product_match_status', 'linked',
    'quantity', 1, 'variant_id', v_addon_variant_id,
    'variant_attributes', '{}'::jsonb, 'variant_name', '61W'
  );
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_user_id::text, true);
  PERFORM set_config('app.branch_audit_actor_id', v_owner_user_id::text, true);

  INSERT INTO public.branches (id, merchant_id, name, is_default, active)
  VALUES (v_branch_id, v_merchant_id, 'Append Review Branch', false, true);

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', oi.product_id, 'variant_id', oi.variant_id,
        'variant_name', NULLIF(btrim(oi.variant_name), ''),
        'name', btrim(oi.name), 'quantity', oi.quantity, 'price', oi.price,
        'condition', NULLIF(btrim(oi.condition), ''),
        'image_url', NULLIF(btrim(oi.image_url), ''),
        'item_description', NULLIF(btrim(oi.item_description), ''),
        'variant_attributes', CASE
          WHEN jsonb_typeof(COALESCE(oi.variant_attributes, '{}'::jsonb)) = 'object'
            THEN COALESCE(oi.variant_attributes, '{}'::jsonb)
          ELSE '{}'::jsonb
        END,
        'product_match_status', COALESCE(
          NULLIF(btrim(oi.product_match_status), ''),
          CASE WHEN oi.product_id IS NULL THEN 'custom' ELSE 'linked' END
        )
      ) ORDER BY oi.product_id, oi.variant_id, btrim(oi.name), oi.price, oi.quantity
    ), '[]'::jsonb
  ) INTO v_existing_items
  FROM public.order_items AS oi
  WHERE oi.order_id = v_order_id;

  SELECT jsonb_build_object(
    'branch_id', o.branch_id,
    'customer', jsonb_build_object(
      'id', o.customer_id, 'name', o.customer_name,
      'email', o.customer_email, 'phone', o.customer_phone
    ),
    'discount_amount', COALESCE(o.discount_amount, 0),
    'gift_wrapping_fee', COALESCE(o.gift_wrapping_fee, 0),
    'items', v_existing_items, 'notify_customer', false,
    'shipping_address', COALESCE(o.shipping_address, '{}'::jsonb),
    'shipping_fee', COALESCE(o.shipping_fee, 0), 'source', o.source,
    'tax_amount', COALESCE(o.tax_amount, 0)
  ) INTO v_payload
  FROM public.orders AS o
  WHERE o.id = v_order_id;

  UPDATE public.merchants
  SET vat_registration_status = 'unregistered'
  WHERE id = v_merchant_id;
  INSERT INTO public.order_tax_subtotals (
    order_id, vat_category_code, vat_rate, taxable_amount, tax_amount,
    exemption_reason, exemption_reason_code
  ) VALUES (
    v_order_id, 'E', 0, 1234, 0, 'Outside scope', 'VAT-OUTSIDE-SCOPE'
  ), (
    v_order_id, 'S', 7.5, 1001000, 0, 'Standard supply', 'VAT-STANDARD'
  )
  ON CONFLICT (order_id, vat_category_code, vat_rate) DO UPDATE
  SET taxable_amount = EXCLUDED.taxable_amount,
    tax_amount = EXCLUDED.tax_amount,
    exemption_reason = EXCLUDED.exemption_reason,
    exemption_reason_code = EXCLUDED.exemption_reason_code;

  PERFORM public.update_admin_order_with_transaction_discount_metadata(
    v_order_id,
    v_payload || jsonb_build_object(
      'items', v_existing_items || jsonb_build_array(v_new_line)
    )
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.order_tax_subtotals
    WHERE order_id = v_order_id AND vat_category_code = 'E'
      AND exemption_reason = 'Outside scope'
      AND exemption_reason_code = 'VAT-OUTSIDE-SCOPE'
      AND taxable_amount = 1234
  ) THEN
    RAISE EXCEPTION 'unregistered append discarded tax subtotal metadata';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.order_tax_subtotals
    WHERE order_id = v_order_id AND vat_category_code = 'S' AND vat_rate = 7.5
      AND taxable_amount = 1002000
      AND exemption_reason = 'Standard supply'
      AND exemption_reason_code = 'VAT-STANDARD'
  ) THEN
    RAISE EXCEPTION 'unregistered append did not rebuild taxable subtotal';
  END IF;
  v_existing_items := v_existing_items || jsonb_build_array(v_new_line);

  UPDATE public.orders
  SET branch_id = v_branch_id, source = 'append-review-source',
    notes = 'append-review-notes'
  WHERE id = v_order_id;
  v_omitted_payload :=
    (v_payload - 'branch_id' - 'source' - 'notes')
    || jsonb_build_object(
      'customer', (v_payload -> 'customer') - 'id',
      'items', v_existing_items || jsonb_build_array(v_omitted_line)
    );

  PERFORM public.update_admin_order_with_transaction_discount_metadata(v_order_id, v_omitted_payload);
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = v_order_id AND branch_id = v_branch_id
      AND customer_id = v_customer_id AND source = 'append-review-source'
      AND notes = 'append-review-notes'
  ) THEN
    RAISE EXCEPTION 'append did not preserve omitted order metadata';
  END IF;
  v_existing_items := v_existing_items || jsonb_build_array(v_omitted_line);

  PERFORM public.update_admin_order_with_transaction_discount_metadata(
    v_order_id,
    v_omitted_payload || jsonb_build_object(
      'branch_id', null,
      'customer', jsonb_build_object(
        'id', null, 'name', 'Append Buyer',
        'email', 'append-buyer@example.com', 'phone', '+2348012345678'
      ),
      'notes', null,
      'source', null,
      'items', v_existing_items || jsonb_build_array(v_explicit_null_line)
    )
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.orders
    WHERE id = v_order_id AND branch_id IS NULL AND customer_id IS NULL
      AND source IS NULL AND notes IS NULL
  ) THEN
    RAISE EXCEPTION 'append did not apply explicit null order metadata';
  END IF;
  v_existing_items := v_existing_items || jsonb_build_array(v_explicit_null_line);

  UPDATE public.merchants
  SET vat_registration_status = 'registered'
  WHERE id = v_merchant_id;
  UPDATE public.products SET vat_category_code = 'Z', vat_rate = 0
  WHERE id IN (v_product_id, v_addon_product_id);
  UPDATE public.order_items
  SET vat_category_code = 'Z', vat_rate = 0, vat_amount = 0
  WHERE order_id = v_order_id;

  PERFORM public.update_admin_order_with_transaction_discount_metadata(
    v_order_id,
    v_omitted_payload || jsonb_build_object(
      'tax_amount', 1250,
      'items', v_existing_items || jsonb_build_array(v_zero_tax_line)
    )
  );

  IF (
    SELECT tax_amount FROM public.order_tax_subtotals
    WHERE order_id = v_order_id AND vat_category_code = 'Z' AND vat_rate = 0
  ) IS DISTINCT FROM 1250 THEN
    RAISE EXCEPTION 'positive tax was discarded when every group had zero tax weight';
  END IF;
END;
$test$ LANGUAGE plpgsql;

RESET ROLE;

\ir 005_unreviewed_scenarios.sql
