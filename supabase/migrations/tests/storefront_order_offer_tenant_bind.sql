-- =============================================
-- BEHAVIORAL TEST: inserted offer ids are bound to the line's product
-- and the order's merchant, and the label-snapshot marker is frozen.
--   A direct order_items insert referencing another merchant's offer
--   (or another product's offer) fails closed, so a later cancel can
--   never restock a victim offer checkout never decremented; a legit
--   same-tenant insert still passes with the snapshot stamped; and
--   flipping offer_labels_snapshotted after insert fails closed, so
--   the admin reader cannot be pushed back onto mutable live labels.
--
-- USAGE:
--   psql $DATABASE_URL -f supabase/migrations/tests/storefront_order_offer_tenant_bind.sql
-- =============================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_a uuid := '0be10000-0000-4000-8000-000000000001';
  v_merchant_b uuid := '0be10000-0000-4000-8000-000000000002';
  v_product_a uuid := '0be10000-0000-4000-8000-000000000011';
  v_product_b uuid := '0be10000-0000-4000-8000-000000000012';
  v_product_b2 uuid := '0be10000-0000-4000-8000-000000000013';
  v_offer_a uuid := '0be10000-0000-4000-8000-000000000021';
  v_offer_b uuid := '0be10000-0000-4000-8000-000000000022';
  v_offer_b2 uuid := '0be10000-0000-4000-8000-000000000023';
  v_order_b uuid;
  v_line_id uuid := '0be10000-0000-4000-8000-000000000031';
  v_line record;
  v_cross_merchant_blocked boolean := false;
  v_cross_product_blocked boolean := false;
  v_marker_flip_blocked boolean := false;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug, is_published)
  VALUES (v_merchant_a, 'tenant-bind-a@example.com',
    'Tenant Bind A', 'tenant-bind-a', true),
    (v_merchant_b, 'tenant-bind-b@example.com',
    'Tenant Bind B', 'tenant-bind-b', true);

  INSERT INTO public.products (id, merchant_id, name, price, status,
    stock_quantity, manage_stock, has_condition_offers, has_variants)
  VALUES (v_product_a, v_merchant_a, 'Tenant phone A', 500000,
    'active', 5, false, true, false),
    (v_product_b, v_merchant_b, 'Tenant phone B', 500000,
    'active', 5, false, true, false),
    (v_product_b2, v_merchant_b, 'Tenant phone B2', 300000,
    'active', 5, false, true, false);

  INSERT INTO public.product_offers (id, product_id, merchant_id, condition,
    price, stock_quantity, status, grade, condition_notes)
  VALUES (v_offer_a, v_product_a, v_merchant_a, 'used', 400000, 5,
    'active', 'A', 'Light scratches'),
    (v_offer_b, v_product_b, v_merchant_b, 'used', 400000, 5,
    'active', 'B', 'Moderate wear'),
    (v_offer_b2, v_product_b2, v_merchant_b, 'used', 250000, 5,
    'active', 'C', 'Heavy wear');

  BEGIN
    SELECT o.id INTO v_order_b
    FROM public.create_storefront_order(
      p_merchant_id => v_merchant_b,
      p_customer_email => 'tenant-bind-buyer@example.com',
      p_customer_name => 'Tenant Bind Buyer',
      p_items => jsonb_build_array(jsonb_build_object(
        'product_id', v_product_b,
        'condition', 'used',
        'quantity', 1
      ))
    ) AS o;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'tenant-bind order creation failed: % (%)', SQLERRM, SQLSTATE;
  END;

  -- Cross-merchant: merchant B's order cannot reference A's offer.
  BEGIN
    INSERT INTO public.order_items (order_id, product_id, name, price,
      quantity, offer_id)
    VALUES (v_order_b, v_product_b, 'Foreign offer line', 400000, 1,
      v_offer_a);
  EXCEPTION WHEN raise_exception THEN
    v_cross_merchant_blocked := true;
  END;
  IF NOT v_cross_merchant_blocked THEN
    RAISE EXCEPTION 'expected cross-merchant offer insert to fail, but it succeeded';
  END IF;

  -- Cross-product: same merchant, but the offer belongs to another line.
  BEGIN
    INSERT INTO public.order_items (order_id, product_id, name, price,
      quantity, offer_id)
    VALUES (v_order_b, v_product_b, 'Foreign product line', 250000, 1,
      v_offer_b2);
  EXCEPTION WHEN raise_exception THEN
    v_cross_product_blocked := true;
  END;
  IF NOT v_cross_product_blocked THEN
    RAISE EXCEPTION 'expected cross-product offer insert to fail, but it succeeded';
  END IF;

  -- Legit same-tenant insert still passes with the snapshot stamped,
  -- mimicking the RPC-stamped marker for the freeze check below.
  INSERT INTO public.order_items (id, order_id, product_id, name, price,
    quantity, offer_id, offer_grade, offer_condition_notes,
    offer_labels_snapshotted)
  VALUES (v_line_id, v_order_b, v_product_b, 'Tenant offer line', 400000,
    1, v_offer_b, 'B', 'Moderate wear', true)
  RETURNING offer_id_snapshot, offer_line INTO v_line;
  IF v_line.offer_id_snapshot IS DISTINCT FROM v_offer_b THEN
    RAISE EXCEPTION 'expected stamped snapshot %, got %', v_offer_b, v_line.offer_id_snapshot;
  END IF;
  IF v_line.offer_line IS NOT TRUE THEN
    RAISE EXCEPTION 'expected derived offer_line true, got %', v_line.offer_line;
  END IF;

  -- Marker freeze: flipping the stamped marker fails closed.
  BEGIN
    UPDATE public.order_items
    SET offer_labels_snapshotted = false
    WHERE id = v_line_id;
  EXCEPTION WHEN raise_exception THEN
    v_marker_flip_blocked := true;
  END;
  IF NOT v_marker_flip_blocked THEN
    RAISE EXCEPTION 'expected marker flip to fail, but it succeeded';
  END IF;
END;
$$;

ROLLBACK;
