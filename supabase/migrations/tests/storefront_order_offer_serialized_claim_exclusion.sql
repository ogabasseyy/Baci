-- =============================================
-- REGRESSION TEST (issue #3734): serialized-claim exclusion must match
-- the persisted line identity.
--   An offer_id-only line (no client condition) stages t.condition from
--   the product fallback while t.offer_condition carries the offer's
--   live condition; the persisted oi.condition is the COALESCE of both.
--   The serialized-unit claim loop must exclude that line, otherwise it
--   reserves base-product units after the offer stock decrement.
--   NOTE: a condition-only line (condition without offer_id) is not a
--   valid shape on a serialized product: condition_valid requires a
--   quantity-managed pool, and serialized policies are never managed.
--   The fixture therefore covers the supported offer shapes only:
--   two offer_id-only units of one offer (A/B), a same-product plain
--   line colliding with the product fallback condition (C), a second
--   offer's unit (D), and a plain control line on another product (E).
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
  v_newoffer_id uuid := '03d00000-0000-4000-8000-000000000011';
  v_anchor_id uuid := '03d00000-0000-4000-8000-000000000004';
  v_unit_id uuid := '03d00000-0000-4000-8000-000000000005';
  v_plain_product_id uuid := '03d00000-0000-4000-8000-000000000008';
  v_plain_anchor_id uuid := '03d00000-0000-4000-8000-000000000009';
  v_plain_unit_id uuid := '03d00000-0000-4000-8000-000000000010';
  v_order_id uuid;
  v_tracking_token text;
  v_item_id uuid;
  v_item_b uuid;
  v_item_c uuid;
  v_item_d uuid;
  v_plain_item_id uuid;
  v_condition text;
  v_offer_stock integer;
  v_newoffer_stock integer;
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
    'active', 'A', 'Light scratches'),
    (v_newoffer_id, v_product_id, v_merchant_id, 'new', 450000, 5,
    'active', 'A', 'Mint in box');

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
          'product_id', v_product_id,
          'offer_id', v_offer_id,
          'quantity', 1
        ),
        jsonb_build_object(
          'product_id', v_product_id,
          'quantity', 1
        ),
        jsonb_build_object(
          'product_id', v_product_id,
          'offer_id', v_newoffer_id,
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
  WHERE order_id = v_order_id AND product_id = v_product_id
    AND offer_id = v_offer_id
  ORDER BY id LIMIT 1;
  IF v_condition IS DISTINCT FROM 'used' THEN
    RAISE EXCEPTION 'expected live offer condition used, got %', v_condition;
  END IF;

  SELECT id INTO v_item_b
  FROM public.order_items
  WHERE order_id = v_order_id AND product_id = v_product_id
    AND offer_id = v_offer_id AND id IS DISTINCT FROM v_item_id;
  IF v_item_b IS NULL THEN
    RAISE EXCEPTION 'expected second same-offer line to persist';
  END IF;

  -- Collision case (wi-oo): same product/variant, plain line whose
  -- condition equals the new offer's. Tuple matching would mis-exclude
  -- it; line-identity markers must not.
  SELECT id INTO v_item_c
  FROM public.order_items
  WHERE order_id = v_order_id AND product_id = v_product_id
    AND offer_id IS NULL AND condition = 'new';
  IF v_item_c IS NULL THEN
    RAISE EXCEPTION 'expected same-product plain line to persist';
  END IF;

  SELECT id INTO v_item_d
  FROM public.order_items
  WHERE order_id = v_order_id AND product_id = v_product_id
    AND offer_id = v_newoffer_id;
  IF v_item_d IS NULL THEN
    RAISE EXCEPTION 'expected new-condition offer line to persist';
  END IF;

  SELECT id INTO v_plain_item_id
  FROM public.order_items
  WHERE order_id = v_order_id AND product_id = v_plain_product_id;
  IF v_plain_item_id IS NULL THEN
    RAISE EXCEPTION 'expected plain control line to persist';
  END IF;

  SELECT stock_quantity INTO v_offer_stock
  FROM public.product_offers WHERE id = v_offer_id;
  IF v_offer_stock <> 3 THEN
    RAISE EXCEPTION 'expected used-offer stock 3 after two lines, got %', v_offer_stock;
  END IF;

  SELECT stock_quantity INTO v_newoffer_stock
  FROM public.product_offers WHERE id = v_newoffer_id;
  IF v_newoffer_stock <> 4 THEN
    RAISE EXCEPTION 'expected new-offer stock 4 after quantity 1, got %', v_newoffer_stock;
  END IF;

  -- The serialized claim loop must skip the offer lines: no
  -- base-product unit may be reserved for them.
  SELECT count(*) INTO v_claimed
  FROM public.variant_inventory
  WHERE order_item_id IN (v_item_id, v_item_b, v_item_d);
  SELECT count(*) INTO v_plain_claimed
  FROM public.variant_inventory
  WHERE order_item_id IN (v_item_c, v_plain_item_id);
  IF v_plain_claimed <> 2 THEN
    RAISE EXCEPTION 'expected plain lines to keep exactly two claimed units, got %', v_plain_claimed;
  END IF;
  IF v_claimed <> 0 THEN
    RAISE EXCEPTION 'expected no serialized units claimed for the offer line, got %', v_claimed;
  END IF;

  -- Legacy shape: pre-19100000 creators persisted product_offer_id with
  -- offer_line false (the backfill keyed on offer_id; the trigger now
  -- derives from both). Simulate it by flipping the marker with the
  -- identity guard disabled; the product_offer_id stays set.
  RESET ROLE;
  ALTER TABLE public.order_items DISABLE TRIGGER order_items_offer_id_snapshot_guard;
  UPDATE public.order_items SET offer_line = false WHERE id = v_item_id;
  ALTER TABLE public.order_items ENABLE TRIGGER order_items_offer_id_snapshot_guard;
  SET LOCAL ROLE service_role;

  -- The pending-order reuse path must skip it too, keyed on either
  -- marker: run the order through
  -- prepare_storefront_order_for_checkout (unpaid + pending = reusable)
  -- and assert still zero claimed units. Seed a refund-like shape (no
  -- inventoryUnits claim) on one untouched line to prove the helper
  -- preserves non-unit fields it must not touch.
  UPDATE public.order_items SET fulfillment_data = jsonb_build_object(
    'source', 'merchant_stock',
    'fulfillmentQuantity', 1
  ) WHERE id = v_item_d;

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
  WHERE order_item_id IN (v_item_id, v_item_b, v_item_d);
  SELECT count(*) INTO v_plain_claimed
  FROM public.variant_inventory
  WHERE order_item_id IN (v_item_c, v_plain_item_id);
  IF v_plain_claimed <> 2 THEN
    RAISE EXCEPTION 'expected plain lines to keep exactly two claimed units, got %', v_plain_claimed;
  END IF;
  IF v_claimed <> 0 THEN
    RAISE EXCEPTION 'expected no serialized units claimed for the offer line after reuse, got %', v_claimed;
  END IF;

  -- The refund-like shape must survive reuse untouched (no
  -- inventoryUnits claim, so the helper must not touch it).
  IF (SELECT fulfillment_data FROM public.order_items WHERE id = v_item_d)
     IS DISTINCT FROM jsonb_build_object('source', 'merchant_stock', 'fulfillmentQuantity', 1) THEN
    RAISE EXCEPTION 'expected refund-like fulfillment on the untouched offer line to survive reuse';
  END IF;

  IF (SELECT count(*) FROM public.order_items
      WHERE id IN (v_item_id, v_item_b)
      AND fulfillment_data IS NOT NULL) <> 0 THEN
    RAISE EXCEPTION 'expected untouched offer lines to keep NULL fulfillment_data after reuse';
  END IF;

  -- Legacy state: an order created before the fix holds a wrongly
  -- reserved unit. Reuse must release it instead of refreshing it.
  -- Seed a stale snapshot on the line first so the post-release NULL
  -- proves the helper actually cleared it (rather than NULL-to-NULL).
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

  UPDATE public.order_items SET fulfillment_data = jsonb_build_object(
    'source', 'merchant_stock',
    'reservationExpiresAt', now() + interval '1 hour',
    'inventoryUnits', jsonb_build_array(jsonb_build_object(
      'inventoryUnitId', '03d00000-0000-4000-8000-000000000006',
      'identifierType', 'imei',
      'identifierValue', '933730000000002'
    )),
    'missingUnitCount', 0
  ) WHERE id = v_item_id;

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

  IF (SELECT fulfillment_data FROM public.order_items WHERE id = v_item_id) IS NOT NULL THEN
    RAISE EXCEPTION 'expected released offer line to return to NULL fulfillment_data';
  END IF;

  -- The release must be audited against the unit's own variant with
  -- the actual from-status and the reuse path context.
  IF (SELECT count(*) FROM private.variant_inventory_events
      WHERE inventory_unit_id = '03d00000-0000-4000-8000-000000000006'
      AND event_type = 'reservation_released'
      AND from_status = 'reserved' AND to_status = 'available'
      AND order_id = v_order_id AND order_item_id = v_item_id
      AND variant_id = v_anchor_id
      AND event_context->>'releaseReason' = 'checkout_reuse'
      AND event_context->>'fulfillmentPath' = 'order_reuse') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one audited reuse release event for the legacy unit';
  END IF;

  -- The stock-sync trigger must resync projections on the helper's
  -- status flip: exactly the freed unit is available again.
  SELECT stock_quantity INTO v_offer_stock
  FROM public.products WHERE id = v_product_id;
  IF v_offer_stock <> 1 THEN
    RAISE EXCEPTION 'expected resynced product stock 1 after legacy release, got %', v_offer_stock;
  END IF;
  SELECT stock_quantity INTO v_offer_stock
  FROM public.product_variants WHERE id = v_anchor_id;
  IF v_offer_stock <> 1 THEN
    RAISE EXCEPTION 'expected resynced anchor stock 1 after legacy release, got %', v_offer_stock;
  END IF;

  -- Post-deletion legacy shape: a condition-only offer line created
  -- before 19100000 whose offer was later deleted carries offer_line
  -- false with both FKs nulled (ON DELETE SET NULL) while the
  -- snapshotted flag stays true. Simulate it on the second same-offer
  -- line, attach a wrongly reserved unit, and assert reuse still
  -- routes it as an offer line (release, no claim).
  RESET ROLE;
  ALTER TABLE public.order_items DISABLE TRIGGER order_items_offer_id_snapshot_guard;
  UPDATE public.order_items
  SET offer_id = NULL,
      offer_id_snapshot = NULL,
      offer_line = false,
      product_offer_id = NULL
  WHERE id = v_item_b;
  ALTER TABLE public.order_items ENABLE TRIGGER order_items_offer_id_snapshot_guard;
  SET LOCAL ROLE service_role;

  INSERT INTO public.variant_inventory (
    id, variant_id, merchant_id, identifier_type, identifier_value,
    status, order_id, order_item_id, reserved_at, first_reserved_at,
    reservation_expires_at
  )
  VALUES (
    '03d00000-0000-4000-8000-000000000012', v_anchor_id, v_merchant_id,
    'imei', '933730000000012', 'reserved', v_order_id, v_item_b,
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
    RAISE EXCEPTION 'offer order post-deletion reuse failed: % (%)', SQLERRM, SQLSTATE;
  END;

  SELECT status, order_item_id INTO v_legacy_status, v_legacy_item
  FROM public.variant_inventory
  WHERE id = '03d00000-0000-4000-8000-000000000012';
  IF v_legacy_status IS DISTINCT FROM 'available' THEN
    RAISE EXCEPTION 'expected post-deletion legacy unit released to available, got %', v_legacy_status;
  END IF;
  IF v_legacy_item IS NOT NULL THEN
    RAISE EXCEPTION 'expected post-deletion legacy unit detached from the offer line, got %', v_legacy_item;
  END IF;
  SELECT count(*) INTO v_claimed
  FROM public.variant_inventory
  WHERE order_item_id = v_item_b;
  IF v_claimed <> 0 THEN
    RAISE EXCEPTION 'expected no serialized units held for the post-deletion offer line, got %', v_claimed;
  END IF;
  IF (SELECT count(*) FROM private.variant_inventory_events
      WHERE inventory_unit_id = '03d00000-0000-4000-8000-000000000012'
      AND event_type = 'reservation_released'
      AND from_status = 'reserved' AND to_status = 'available'
      AND order_id = v_order_id AND order_item_id = v_item_b
      AND variant_id = v_anchor_id
      AND event_context->>'releaseReason' = 'checkout_reuse'
      AND event_context->>'fulfillmentPath' = 'order_reuse') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one audited reuse release event for the post-deletion unit';
  END IF;
  SELECT stock_quantity INTO v_offer_stock
  FROM public.products WHERE id = v_product_id;
  IF v_offer_stock <> 2 THEN
    RAISE EXCEPTION 'expected resynced product stock 2 after post-deletion release, got %', v_offer_stock;
  END IF;

  -- Detached-elsewhere stale snapshot: unit 012 is now available and
  -- detached, but a leftover snapshot still claims it. Reuse must
  -- strip the unit keys even though this call frees nothing
  -- (released_count = 0); the unit-less remainder collapses to NULL.
  UPDATE public.order_items SET fulfillment_data = jsonb_build_object(
    'source', 'merchant_stock',
    'reservationExpiresAt', now() + interval '1 hour',
    'inventoryUnits', jsonb_build_array(jsonb_build_object(
      'inventoryUnitId', '03d00000-0000-4000-8000-000000000012',
      'identifierType', 'imei',
      'identifierValue', '933730000000012'
    )),
    'missingUnitCount', 0
  ) WHERE id = v_item_b;

  BEGIN
    PERFORM private.prepare_storefront_order_for_checkout(
      p_order_id => v_order_id,
      p_merchant_id => v_merchant_id,
      p_tracking_token => v_tracking_token,
      p_customer_email => 'claim-exclusion-buyer@example.com',
      p_payment_method => 'card'
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'offer order stale-snapshot reuse failed: % (%)', SQLERRM, SQLSTATE;
  END;

  IF (SELECT fulfillment_data FROM public.order_items WHERE id = v_item_b) IS NOT NULL THEN
    RAISE EXCEPTION 'expected detached-elsewhere stale snapshot stripped to NULL on reuse';
  END IF;
  IF (SELECT fulfillment_data FROM public.order_items WHERE id = v_item_d)
     IS DISTINCT FROM jsonb_build_object('source', 'merchant_stock', 'fulfillmentQuantity', 1) THEN
    RAISE EXCEPTION 'expected refund-like fulfillment to survive the stale-snapshot reuse';
  END IF;

  -- Payment confirmation path: a paid serialized offer order must not
  -- reclaim base-product units nor raise late_payment_reservation_lost.
  -- Attach a unit to the snapshot-only (post-deletion) line so the
  -- first confirmation exercises the confirm guard's snapshot term
  -- and its payment_confirmation event context.
  INSERT INTO public.variant_inventory (
    id, variant_id, merchant_id, identifier_type, identifier_value,
    status, order_id, order_item_id, reserved_at, first_reserved_at,
    reservation_expires_at
  )
  VALUES (
    '03d00000-0000-4000-8000-000000000013', v_anchor_id, v_merchant_id,
    'imei', '933730000000013', 'reserved', v_order_id, v_item_b,
    now(), now(), now() + interval '1 hour'
  );

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
  WHERE order_item_id IN (v_item_id, v_item_b, v_item_d);
  SELECT count(*) INTO v_plain_claimed
  FROM public.variant_inventory
  WHERE order_item_id IN (v_item_c, v_plain_item_id);
  IF v_plain_claimed <> 2 THEN
    RAISE EXCEPTION 'expected plain lines to keep exactly two claimed units, got %', v_plain_claimed;
  END IF;
  IF v_claimed <> 0 THEN
    RAISE EXCEPTION 'expected no serialized units claimed for the offer line on confirm, got %', v_claimed;
  END IF;
  IF (SELECT fulfillment_data FROM public.order_items WHERE id = v_item_d)
     IS DISTINCT FROM jsonb_build_object('source', 'merchant_stock', 'fulfillmentQuantity', 1) THEN
    RAISE EXCEPTION 'expected refund-like fulfillment on the untouched offer line to survive confirm';
  END IF;

  SELECT status, order_item_id INTO v_legacy_status, v_legacy_item
  FROM public.variant_inventory
  WHERE id = '03d00000-0000-4000-8000-000000000013';
  IF v_legacy_status IS DISTINCT FROM 'available' THEN
    RAISE EXCEPTION 'expected confirm to release the snapshot-only legacy unit, got %', v_legacy_status;
  END IF;
  IF v_legacy_item IS NOT NULL THEN
    RAISE EXCEPTION 'expected snapshot-only legacy unit detached on confirm, got %', v_legacy_item;
  END IF;
  IF (SELECT count(*) FROM private.variant_inventory_events
      WHERE inventory_unit_id = '03d00000-0000-4000-8000-000000000013'
      AND event_type = 'reservation_released'
      AND from_status = 'reserved' AND to_status = 'available'
      AND order_id = v_order_id AND order_item_id = v_item_b
      AND variant_id = v_anchor_id
      AND event_context->>'fulfillmentPath' = 'payment_confirmation') <> 1 THEN
    RAISE EXCEPTION 'expected exactly one audited confirm release event for the snapshot-only unit';
  END IF;
  SELECT stock_quantity INTO v_offer_stock
  FROM public.products WHERE id = v_product_id;
  IF v_offer_stock <> 3 THEN
    RAISE EXCEPTION 'expected resynced product stock 3 after confirm release, got %', v_offer_stock;
  END IF;

  -- Paid-without-reuse legacy case: a durable (NULL-expiry) reserved
  -- hold that never passed the reuse cleanup must be released by
  -- confirmation, not confirmed or skipped. Durable holds are status
  -- 'reserved' with reservation_expires_at NULL; no separate
  -- non-expiring status exists in this schema.
  INSERT INTO public.variant_inventory (
    id, variant_id, merchant_id, identifier_type, identifier_value,
    status, order_id, order_item_id, reserved_at, first_reserved_at,
    reservation_expires_at
  )
  VALUES (
    '03d00000-0000-4000-8000-000000000007', v_anchor_id, v_merchant_id,
    'imei', '933730000000004', 'reserved', v_order_id, v_item_id,
    now(), now(), NULL
  );

  BEGIN
    PERFORM public.confirm_order_inventory_reservations(
      p_merchant_id => v_merchant_id,
      p_order_id => v_order_id
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'offer order second confirmation failed: % (%)', SQLERRM, SQLSTATE;
  END;

  SELECT status, order_item_id INTO v_legacy_status, v_legacy_item
  FROM public.variant_inventory
  WHERE id = '03d00000-0000-4000-8000-000000000007';
  IF v_legacy_status IS DISTINCT FROM 'available' THEN
    RAISE EXCEPTION 'expected durable legacy unit released to available, got %', v_legacy_status;
  END IF;
  IF v_legacy_item IS NOT NULL THEN
    RAISE EXCEPTION 'expected durable legacy unit detached, got %', v_legacy_item;
  END IF;
  SELECT stock_quantity INTO v_offer_stock
  FROM public.products WHERE id = v_product_id;
  IF v_offer_stock <> 4 THEN
    RAISE EXCEPTION 'expected resynced product stock 4 after durable release, got %', v_offer_stock;
  END IF;
  -- The plain control product must be untouched by every release above.
  SELECT stock_quantity INTO v_plain_claimed
  FROM public.products WHERE id = v_plain_product_id;
  IF v_plain_claimed <> 0 THEN
    RAISE EXCEPTION 'expected plain product stock 0 (unit still reserved), got %', v_plain_claimed;
  END IF;
END;
$$;

ROLLBACK;
