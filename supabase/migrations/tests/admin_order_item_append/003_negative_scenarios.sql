RESET ROLE;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data,
  raw_user_meta_data
) VALUES (
  '00000000-0000-4000-8000-00000000d601',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'order-item-append-foreign@example.com',
  'test', now(), now(), now(), '{}'::jsonb, '{}'::jsonb
);

INSERT INTO public.merchants (id, user_id, email, business_name, slug)
VALUES (
  '00000000-0000-4000-8000-00000000d701',
  '00000000-0000-4000-8000-00000000d601',
  'order-item-append-foreign-merchant@example.com',
  'Order Item Append Foreign Merchant',
  'order-item-append-foreign-merchant'
);

INSERT INTO public.products (
  id, merchant_id, name, price, manage_stock, status, vat_category_code, vat_rate
) VALUES
  (
    '00000000-0000-4000-8000-00000000d801',
    '00000000-0000-4000-8000-00000000d701',
    'Foreign Merchant Product', 1000, false, 'active', 'S', 7.5
  ),
  (
    '00000000-0000-4000-8000-00000000d802',
    '00000000-0000-4000-8000-00000000c101',
    'Managed Stock Product', 1000, true, 'active', 'S', 7.5
  );

SET LOCAL ROLE authenticated;

DO $test$
DECLARE
  v_order_id uuid := '00000000-0000-4000-8000-00000000c401';
  v_owner_user_id uuid := '00000000-0000-4000-8000-00000000c001';
  v_existing_items jsonb;
  v_payload jsonb;
  v_foreign_line jsonb := jsonb_build_object(
    'condition', null, 'image_url', null, 'item_description', null,
    'name', 'Foreign Merchant Product', 'price', 1000,
    'product_id', '00000000-0000-4000-8000-00000000d801'::uuid,
    'product_match_status', 'linked', 'quantity', 1, 'variant_id', null,
    'variant_attributes', '{}'::jsonb, 'variant_name', null
  );
  v_paid_line jsonb := jsonb_build_object(
    'condition', null, 'image_url', null, 'item_description', null,
    'name', 'Paid Order Custom Line', 'price', 1000, 'product_id', null,
    'product_match_status', 'custom', 'quantity', 1, 'variant_id', null,
    'variant_attributes', '{}'::jsonb, 'variant_name', null
  );
  v_managed_line jsonb := jsonb_build_object(
    'condition', null, 'image_url', null, 'item_description', null,
    'name', 'Managed Stock Product Line', 'price', 1000,
    'product_id', '00000000-0000-4000-8000-00000000d802'::uuid,
    'product_match_status', 'linked', 'quantity', 1, 'variant_id', null,
    'variant_attributes', '{}'::jsonb, 'variant_name', null
  );
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_user_id::text, true);

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

  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(
      v_order_id,
      v_payload || jsonb_build_object(
        'items', v_existing_items || jsonb_build_array(v_foreign_line)
      )
    );
    RAISE EXCEPTION 'cross-merchant product unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLSTATE <> '42501' OR SQLERRM <> 'order_item_product_forbidden' THEN
      RAISE;
    END IF;
  END;

  UPDATE public.orders SET payment_status = 'paid' WHERE id = v_order_id;
  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(
      v_order_id,
      v_payload || jsonb_build_object(
        'items', v_existing_items || jsonb_build_array(v_paid_line)
      )
    );
    RAISE EXCEPTION 'paid order append unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLSTATE <> '23514' OR SQLERRM <> 'order_financial_edit_has_payments' THEN
      RAISE;
    END IF;
  END;
  UPDATE public.orders SET payment_status = 'unpaid' WHERE id = v_order_id;

  UPDATE public.orders SET shipping_status = 'delivered' WHERE id = v_order_id;
  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(
      v_order_id,
      v_payload || jsonb_build_object(
        'items', v_existing_items || jsonb_build_array(v_paid_line)
      )
    );
    RAISE EXCEPTION 'fulfilled order append unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLSTATE <> '23514' OR SQLERRM <> 'order_financial_edit_after_fulfillment' THEN
      RAISE;
    END IF;
  END;
  UPDATE public.orders SET shipping_status = 'pending' WHERE id = v_order_id;

  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(
      v_order_id,
      v_payload || jsonb_build_object(
        'items', v_existing_items || jsonb_build_array(v_managed_line)
      )
    );
    RAISE EXCEPTION 'stock-managed product append unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLSTATE <> '23514' OR SQLERRM <> 'order_item_replacement_has_managed_stock' THEN
      RAISE;
    END IF;
  END;
END;
$test$ LANGUAGE plpgsql;

RESET ROLE;
