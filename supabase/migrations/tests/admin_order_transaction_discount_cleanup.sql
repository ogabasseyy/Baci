-- =============================================
-- REGRESSION TEST: atomic admin order transaction-discount cleanup
--
-- Validates the wrapper's item/discount cleanup, fee-only preservation,
-- permission boundary, and rollback when the underlying edit fails.
--
-- USAGE:
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/migrations/tests/admin_order_transaction_discount_cleanup.sql
--
-- This script intentionally mutates inside a transaction and rolls back.
-- =============================================

\set ON_ERROR_STOP on

BEGIN;

SELECT set_config(
  'app.audit_actor_user_id',
  '00000000-0000-4000-8000-00000000c001',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-00000000c001',
  true
);
\ir admin_order_item_append/001_setup.sql

DO $$
BEGIN
  IF to_regprocedure(
    'public.update_admin_order_with_transaction_discount_metadata(uuid,jsonb)'
  ) IS NULL THEN
    RAISE EXCEPTION 'transaction discount cleanup wrapper is missing';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.update_admin_order_with_transaction_discount_metadata(uuid,jsonb)'::regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated wrapper execute grant is missing';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.update_admin_order_with_transaction_discount_metadata(uuid,jsonb)'::regprocedure,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anonymous wrapper execute grant must remain revoked';
  END IF;
END;
$$ LANGUAGE plpgsql;

SET LOCAL ROLE authenticated;

DO $test$
DECLARE
  v_order_id uuid := '00000000-0000-4000-8000-00000000c401';
  v_owner_user_id uuid := '00000000-0000-4000-8000-00000000c001';
  v_items jsonb;
  v_changed_items jsonb;
  v_invalid_items jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_tracking jsonb;
  v_before_subtotal numeric;
  v_before_total numeric;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  PERFORM set_config('request.jwt.claim.sub', v_owner_user_id::text, false);

  UPDATE public.orders
  SET ad_tracking = jsonb_build_object(
    'campaign', 'keep-me',
    'baci_transaction_discount', jsonb_build_object(
      'total_discount', 20,
      'line_count', 1
    )
  )
  WHERE id = v_order_id;

  SELECT ad_tracking
  INTO v_tracking
  FROM public.orders
  WHERE id = v_order_id;

  IF v_tracking ? 'baci_transaction_discount' THEN
    RAISE EXCEPTION 'direct authenticated metadata write was not stripped: %', v_tracking;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', oi.product_id,
        'variant_id', oi.variant_id,
        'variant_name', NULLIF(btrim(oi.variant_name), ''),
        'name', btrim(oi.name),
        'quantity', oi.quantity,
        'price', oi.price,
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
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.order_items AS oi
  WHERE oi.order_id = v_order_id;

  SELECT jsonb_build_object(
    'branch_id', o.branch_id,
    'customer', jsonb_build_object(
      'id', o.customer_id,
      'name', o.customer_name,
      'email', o.customer_email,
      'phone', o.customer_phone
    ),
    'discount_amount', COALESCE(o.discount_amount, 0),
    'gift_wrapping_fee', COALESCE(o.gift_wrapping_fee, 0),
    'items', v_items,
    'notes', o.notes,
    'notify_customer', false,
    'shipping_address', COALESCE(o.shipping_address, '{}'::jsonb),
    'shipping_fee', COALESCE(o.shipping_fee, 0),
    'source', o.source,
    'tax_amount', COALESCE(o.tax_amount, 0)
  )
  INTO v_payload
  FROM public.orders AS o
  WHERE o.id = v_order_id;

  v_changed_items := jsonb_set(v_items, '{0,quantity}', '2'::jsonb);
  v_result := public.update_admin_order_with_transaction_discount_metadata(
    v_order_id,
    v_payload || jsonb_build_object('items', v_changed_items)
  );

  IF (v_result -> 'changed_fields') ? 'items' IS NOT TRUE THEN
    RAISE EXCEPTION 'item edit did not report items as changed: %', v_result;
  END IF;

  SELECT ad_tracking
  INTO v_tracking
  FROM public.orders
  WHERE id = v_order_id;

  IF v_tracking -> 'baci_transaction_discount' ->> 'status' IS DISTINCT FROM 'admin_edit'
    OR v_tracking ->> 'campaign' IS DISTINCT FROM 'keep-me'
  THEN
    RAISE EXCEPTION 'item edit did not preserve admin discount provenance: %', v_tracking;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', oi.product_id,
        'variant_id', oi.variant_id,
        'variant_name', NULLIF(btrim(oi.variant_name), ''),
        'name', btrim(oi.name),
        'quantity', oi.quantity,
        'price', oi.price,
        'condition', NULLIF(btrim(oi.condition), ''),
        'image_url', NULLIF(btrim(oi.image_url), ''),
        'item_description', NULLIF(btrim(oi.item_description), ''),
        'variant_attributes', COALESCE(oi.variant_attributes, '{}'::jsonb),
        'product_match_status', COALESCE(
          NULLIF(btrim(oi.product_match_status), ''),
          CASE WHEN oi.product_id IS NULL THEN 'custom' ELSE 'linked' END
        )
      ) ORDER BY oi.product_id, oi.variant_id, btrim(oi.name), oi.price, oi.quantity
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.order_items AS oi
  WHERE oi.order_id = v_order_id;

  SELECT jsonb_build_object(
    'branch_id', o.branch_id,
    'customer', jsonb_build_object(
      'id', o.customer_id,
      'name', o.customer_name,
      'email', o.customer_email,
      'phone', o.customer_phone
    ),
    'discount_amount', COALESCE(o.discount_amount, 0),
    'gift_wrapping_fee', COALESCE(o.gift_wrapping_fee, 0),
    'items', v_items,
    'notes', o.notes,
    'notify_customer', false,
    'shipping_address', COALESCE(o.shipping_address, '{}'::jsonb),
    'shipping_fee', 3500,
    'source', o.source,
    'tax_amount', COALESCE(o.tax_amount, 0)
  )
  INTO v_payload
  FROM public.orders AS o
  WHERE o.id = v_order_id;

  v_result := public.update_admin_order_with_transaction_discount_metadata(
    v_order_id,
    v_payload
  );

  IF (v_result -> 'changed_fields') ? 'shipping_fee' IS NOT TRUE THEN
    RAISE EXCEPTION 'fee-only edit did not report shipping_fee as changed: %', v_result;
  END IF;

  SELECT ad_tracking
  INTO v_tracking
  FROM public.orders
  WHERE id = v_order_id;

  IF v_tracking -> 'baci_transaction_discount' ->> 'status' IS DISTINCT FROM 'admin_edit'
    OR v_tracking ->> 'campaign' IS DISTINCT FROM 'keep-me'
  THEN
    RAISE EXCEPTION 'fee-only edit unexpectedly changed transaction discount metadata: %', v_tracking;
  END IF;

  SELECT subtotal, total
  INTO v_before_subtotal, v_before_total
  FROM public.orders
  WHERE id = v_order_id;

  v_invalid_items := jsonb_set(
    v_items,
    '{0,product_id}',
    to_jsonb('00000000-0000-4000-8000-00000000dead'::text)
  );

  BEGIN
    PERFORM public.update_admin_order_with_transaction_discount_metadata(
      v_order_id,
      v_payload || jsonb_build_object('items', v_invalid_items)
    );
    RAISE EXCEPTION 'invalid item edit unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'order_item_product_forbidden' THEN
      RAISE;
    END IF;
  END;

  SELECT ad_tracking
  INTO v_tracking
  FROM public.orders
  WHERE id = v_order_id;

  IF v_tracking -> 'baci_transaction_discount' ->> 'status' IS DISTINCT FROM 'admin_edit'
    OR v_tracking ->> 'campaign' IS DISTINCT FROM 'keep-me'
  THEN
    RAISE EXCEPTION 'failed item edit did not preserve metadata: %', v_tracking;
  END IF;

  IF (SELECT subtotal FROM public.orders WHERE id = v_order_id) IS DISTINCT FROM v_before_subtotal
    OR (SELECT total FROM public.orders WHERE id = v_order_id) IS DISTINCT FROM v_before_total
  THEN
    RAISE EXCEPTION 'failed item edit changed financial totals';
  END IF;
END;
$test$ LANGUAGE plpgsql;

RESET ROLE;

ROLLBACK;
