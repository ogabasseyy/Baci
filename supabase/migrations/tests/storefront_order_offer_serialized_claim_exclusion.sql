-- =============================================
-- REGRESSION TEST (issue #3734): serialized-claim exclusion must match
-- the persisted condition shape.
--   An offer_id-only line (no client condition) stages t.condition from
--   the product fallback while t.offer_condition carries the offer's
--   live condition; the persisted oi.condition is the COALESCE of both.
--   The serialized-unit claim loop must exclude that line, otherwise it
--   reserves base-product units after the offer stock decrement.
--
-- USAGE:
--   psql $DATABASE_URL -f supabase/migrations/tests/storefront_order_offer_serialized_claim_exclusion.sql
-- =============================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := '03d00000-0000-4000-8000-000000000001';
  v_product_id uuid := '03d00000-0000-4000-8000-000000000002';
  v_offer_id uuid := '03d00000-0000-4000-8000-000000000003';
  v_anchor_id uuid := '03d00000-0000-4000-8000-000000000004';
  v_unit_id uuid := '03d00000-0000-4000-8000-000000000005';
  v_plain_product_id uuid := '03d00000-0000-4000-8000-000000000008';
  v_plain_anchor_id uuid := '03d00000-0000-4000-8000-000000000009';
  v_plain_unit_id uuid := '03d00000-0000-4000-8000-000000000010';
  v_order_id uuid;
  v_tracking_token text;
  v_item_id uuid;
  v_plain_item_id uuid;
  v_condition text;
  v_offer_stock integer;
  v_claimed integer;
  v_plain_claimed integer;
  v_legacy_status text;
  v_legacy_item uuid;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug, is_published)
  VALUES (v_merchant_id, 'claim-exclusion@example.com',
    'Claim Exclusion', 'claim-exclusion', true);

  -- Product condition ('new') deliberately differs from the offer's
  -- live condition ('used'): the client submits offer_id only.
  INSERT INTO public.products (id, merchant_id, name, price, status,
    condition, stock_quantity, manage_stock, has_condition_offers,
    has_variants, inventory_tracking_policy)
  VALUES (v_product_id, v_merchant_id, 'Claim exclusion phone', 500000,
    'active', 'new', 5, false, true, false, 'serialized_strict');

  INSERT INTO public.product_variants (
    id, product_id, merchant_id, attributes, price_override,
    inventory_tracking_policy, is_inventory_anchor
  )
  VALUES (v_anchor_id, v_product_id, v_merchant_id,
    '{"is_anchor": true}'::jsonb, 0, 'inherit', true);

  UPDATE public.products
  SET inventory_anchor_variant_id = v_anchor_id
  WHERE id = v_product_id;

  INSERT INTO public.product_offers (id, product_id, merchant_id, condition,
    price, stock_quantity, status, grade, condition_notes)
  VALUES (v_offer_id, v_product_id, v_merchant_id, 'used', 400000, 5,
    'active', 'A', 'Light scratches');

  -- Positive control: a plain serialized line (no offer) must still
  -- claim exactly one unit through creation, reuse, and confirmation.
  INSERT INTO public.products (id, merchant_id, name, price, status,
    condition, stock_quantity, manage_stock, has_condition_offers,
    has_variants, inventory_tracking_policy)
  VALUES (v_plain_product_id, v_merchant_id, 'Claim exclusion plain', 90000,
    'active', 'new', 5, false, false, false, 'serialized_strict');

  INSERT INTO public.product_variants (
    id, product_id, merchant_id, attributes, price_override,
    inventory_tracking_policy, is_inventory_anchor
  )
  VALUES (v_plain_anchor_id, v_plain_product_id, v_merchant_id,
    '{"is_anchor": true}'::jsonb, 0, 'inherit', true);

  UPDATE public.products
  SET inventory_anchor_variant_id = v_plain_anchor_id
  WHERE id = v_plain_product_id;

  INSERT INTO public.variant_inventory (
    id, variant_id, merchant_id, identifier_type, identifier_value, status
  )
  VALUES (v_unit_id, v_anchor_id, v_merchant_id, 'imei', '933730000000001',
    'available'),
    (v_plain_unit_id, v_plain_anchor_id, v_merchant_id, 'imei', '933730000000003',
    'available');

  BEGIN
    SELECT o.id, o.tracking_token INTO v_order_id, v_tracking_token
    FROM public.create_storefront_order(
      p_merchant_id => v_merchant_id,
      p_customer_email => 'claim-exclusion-buyer@example.com',
      p_customer_name => 'Claim Buyer',
      p_items => jsonb_build_array(
        jsonb_build_object(
          'product_id', v_product_id,
          'offer_id', v_offer_id,
          'quantity', 1
        ),
        jsonb_build_object(
          'product_id', v_plain_product_id,
          'quantity', 1
        )
      )
    ) AS o;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'offer-only order creation failed: % (%)', SQLERRM, SQLSTATE;
  END;

  SELECT id, condition INTO v_item_id, v_condition
  FROM public.order_items
  WHERE order_id = v_order_id AND product_id = v_product_id;
  IF v_condition IS DISTINCT FROM 'used' THEN
    RAISE EXCEPTION 'expected live offer condition used, got %', v_condition;
  END IF;

  SELECT id INTO v_plain_item_id
  FROM public.order_items
  WHERE order_id = v_order_id AND product_id = v_plain_product_id;
  IF v_plain_item_id IS NULL THEN
    RAISE EXCEPTION 'expected plain control line to persist';
  END IF;

  SELECT stock_quantity INTO v_offer_stock
  FROM public.product_offers WHERE id = v_offer_id;
  IF v_offer_stock <> 4 THEN
    RAISE EXCEPTION 'expected offer stock 4 after quantity 1, got %', v_offer_stock;
  END IF;

  -- The serialized claim loop must skip the condition-offer line: no
  -- base-product unit may be reserved for it.
  SELECT count(*) INTO v_claimed
  FROM public.variant_inventory
  WHERE order_item_id = v_item_id;
  SELECT count(*) INTO v_plain_claimed
  FROM public.variant_inventory
  WHERE order_item_id = v_plain_item_id;
  IF v_plain_claimed <> 1 THEN
    RAISE EXCEPTION 'expected plain control line to keep exactly one claimed unit, got %', v_plain_claimed;
  END IF;
  IF v_claimed <> 0 THEN
    RAISE EXCEPTION 'expected no serialized units claimed for the offer line, got %', v_claimed;
  END IF;

  -- Legacy shape: pre-19100000 creators persisted product_offer_id with
  -- offer_line false (the backfill keyed on offer_id; the trigger now
  -- derives from both). Simulate it by flipping the marker with the
  -- identity guard disabled; the product_offer_id stays set.
  ALTER TABLE public.order_items DISABLE TRIGGER order_items_offer_id_snapshot_guard;
  UPDATE public.order_items SET offer_line = false WHERE id = v_item_id;
  ALTER TABLE public.order_items ENABLE TRIGGER order_items_offer_id_snapshot_guard;

  -- The pending-order reuse path must skip it too, keyed on either
  -- marker: run the order through
  -- prepare_storefront_order_for_checkout (unpaid + pending = reusable)
  -- and assert still zero claimed units.
  BEGIN
    PERFORM private.prepare_storefront_order_for_checkout(
      p_order_id => v_order_id,
      p_merchant_id => v_merchant_id,
      p_tracking_token => v_tracking_token,
      p_customer_email => 'claim-exclusion-buyer@example.com',
      p_payment_method => 'card'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'offer order reuse failed: % (%)', SQLERRM, SQLSTATE;
  END;

  SELECT count(*) INTO v_claimed
  FROM public.variant_inventory
  WHERE order_item_id = v_item_id;
  SELECT count(*) INTO v_plain_claimed
  FROM public.variant_inventory
  WHERE order_item_id = v_plain_item_id;
  IF v_plain_claimed <> 1 THEN
    RAISE EXCEPTION 'expected plain control line to keep exactly one claimed unit, got %', v_plain_claimed;
  END IF;
  IF v_claimed <> 0 THEN
    RAISE EXCEPTION 'expected no serialized units claimed for the offer line after reuse, got %', v_claimed;
  END IF;

  -- Legacy state: an order created before the fix holds a wrongly
  -- reserved unit. Reuse must release it instead of refreshing it.
  INSERT INTO public.variant_inventory (
    id, variant_id, merchant_id, identifier_type, identifier_value,
    status, order_id, order_item_id, reserved_at, first_reserved_at,
    reservation_expires_at
  )
  VALUES (
    '03d00000-0000-4000-8000-000000000006', v_anchor_id, v_merchant_id,
    'imei', '933730000000002', 'reserved', v_order_id, v_item_id,
    now(), now(), now() + interval '1 hour'
  );

  BEGIN
    PERFORM private.prepare_storefront_order_for_checkout(
      p_order_id => v_order_id,
      p_merchant_id => v_merchant_id,
      p_tracking_token => v_tracking_token,
      p_customer_email => 'claim-exclusion-buyer@example.com',
      p_payment_method => 'card'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'offer order second reuse failed: % (%)', SQLERRM, SQLSTATE;
  END;

  SELECT status, order_item_id INTO v_legacy_status, v_legacy_item
  FROM public.variant_inventory
  WHERE id = '03d00000-0000-4000-8000-000000000006';
  IF v_legacy_status IS DISTINCT FROM 'available' THEN
    RAISE EXCEPTION 'expected legacy unit released to available, got %', v_legacy_status;
  END IF;
  IF v_legacy_item IS NOT NULL THEN
    RAISE EXCEPTION 'expected legacy unit detached from the offer line, got %', v_legacy_item;
  END IF;

  SELECT count(*) INTO v_plain_claimed
  FROM public.variant_inventory
  WHERE order_item_id = v_plain_item_id;
  IF v_plain_claimed <> 1 THEN
    RAISE EXCEPTION 'expected plain control line to keep exactly one claimed unit after legacy release, got %', v_plain_claimed;
  END IF;

  -- Payment confirmation path: a paid serialized offer order must not
  -- reclaim base-product units nor raise late_payment_reservation_lost.
  UPDATE public.orders SET payment_status = 'paid' WHERE id = v_order_id;

  BEGIN
    PERFORM public.confirm_order_inventory_reservations(
      p_merchant_id => v_merchant_id,
      p_order_id => v_order_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'offer order confirmation failed: % (%)', SQLERRM, SQLSTATE;
  END;

  SELECT count(*) INTO v_claimed
  FROM public.variant_inventory
  WHERE order_item_id = v_item_id;
  SELECT count(*) INTO v_plain_claimed
  FROM public.variant_inventory
  WHERE order_item_id = v_plain_item_id;
  IF v_plain_claimed <> 1 THEN
    RAISE EXCEPTION 'expected plain control line to keep exactly one claimed unit, got %', v_plain_claimed;
  END IF;
  IF v_claimed <> 0 THEN
    RAISE EXCEPTION 'expected no serialized units claimed for the offer line on confirm, got %', v_claimed;
  END IF;
END;
$$;

ROLLBACK;
