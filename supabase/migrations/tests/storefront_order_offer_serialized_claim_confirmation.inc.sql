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
