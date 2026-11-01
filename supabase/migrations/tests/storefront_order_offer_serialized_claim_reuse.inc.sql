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
  v_order_id := (current_setting('test.claim_exclusion_context')::jsonb->>'v_order_id')::uuid;
  v_tracking_token := (current_setting('test.claim_exclusion_context')::jsonb->>'v_tracking_token')::text;
  v_item_id := (current_setting('test.claim_exclusion_context')::jsonb->>'v_item_id')::uuid;
  v_item_b := (current_setting('test.claim_exclusion_context')::jsonb->>'v_item_b')::uuid;
  v_item_c := (current_setting('test.claim_exclusion_context')::jsonb->>'v_item_c')::uuid;
  v_item_d := (current_setting('test.claim_exclusion_context')::jsonb->>'v_item_d')::uuid;
  v_plain_item_id := (current_setting('test.claim_exclusion_context')::jsonb->>'v_plain_item_id')::uuid;
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

END;
$$;
