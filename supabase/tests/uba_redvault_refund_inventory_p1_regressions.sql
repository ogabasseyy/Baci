-- Round-5 P1 regressions for REDVAULT refund inventory reconciliation:
-- an active shipment booking lock must route releases to review,
-- the rebuilt fulfillment payload must retain the surviving quantity, and
-- follow-up refunds for one order must fold into the open review instead of
-- raising a unique violation that aborts finalization.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_order_one uuid := '10000000-0000-4000-8000-000000000001';
  v_order_two uuid := '10000000-0000-4000-8000-000000000002';
  v_product uuid := 'b0000000-0000-4000-8000-000000000001';
  v_variant uuid := 'c0000000-0000-4000-8000-000000000001';
  v_item_one uuid := '20000000-0000-4000-8000-000000000001';
  v_item_two uuid := '20000000-0000-4000-8000-000000000002';
  v_application_one uuid := 'd1000000-0000-4000-8000-000000000001';
  v_application_two uuid := 'd1000000-0000-4000-8000-000000000002';
  v_attempt_one uuid := 'd2000000-0000-4000-8000-000000000001';
  v_attempt_two uuid := 'd2000000-0000-4000-8000-000000000002';
  v_refund_a uuid := 'e1000000-0000-4000-8000-000000000001';
  v_refund_a2 uuid := 'e1000000-0000-4000-8000-000000000004';
  v_refund_c1 uuid := 'e1000000-0000-4000-8000-000000000002';
  v_refund_c2 uuid := 'e1000000-0000-4000-8000-000000000003';
  v_discount uuid := 'f0000000-0000-4000-8000-000000000001';
  v_hash text := '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  v_receipt jsonb;
  v_state text;
  v_count integer;
  v_meta jsonb;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p1@example.com', 'Redvault P1')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R5P1', 'fixed_amount', 100);
  INSERT INTO public.products (id, merchant_id, name, price, inventory_tracking_policy)
  VALUES (v_product, v_merchant, 'Redvault P1 product', 50000, 'serialized_strict');
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy)
  VALUES (v_variant, v_product, v_merchant, 'inherit');

  INSERT INTO public.orders (id, merchant_id, order_number, total, payment_method)
  VALUES (v_order_one, v_merchant, 'R5P1-ONE', 150000, 'uba_redvault'),
         (v_order_two, v_merchant, 'R5P1-TWO', 100000, 'uba_redvault');
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES (v_item_one, v_order_one, v_product, v_variant, 'Redvault P1 item one', 50000, 3),
         (v_item_two, v_order_two, v_product, v_variant, 'Redvault P1 item two', 50000, 2);
  INSERT INTO public.variant_inventory
    (id, merchant_id, order_id, order_item_id, variant_id, status, identifier_type, identifier_value)
  VALUES
    ('a0000000-0000-4000-8000-000000000001', v_merchant, v_order_one, v_item_one, v_variant, 'reserved', 'serial', 'R5P1-001'),
    ('a0000000-0000-4000-8000-000000000002', v_merchant, v_order_one, v_item_one, v_variant, 'reserved', 'serial', 'R5P1-002'),
    ('a0000000-0000-4000-8000-000000000003', v_merchant, v_order_one, v_item_one, v_variant, 'reserved', 'serial', 'R5P1-003'),
    ('a0000000-0000-4000-8000-000000000004', v_merchant, v_order_two, v_item_two, v_variant, 'reserved', 'serial', 'R5P1-004'),
    ('a0000000-0000-4000-8000-000000000005', v_merchant, v_order_two, v_item_two, v_variant, 'reserved', 'serial', 'R5P1-005');

  -- Mirror ops activation so applications pass commercial-terms validation.
  UPDATE private.uba_redvault_runtime
  SET commercial_terms_confirmed = true,
      commercial_terms = jsonb_build_object(
        'campaign_dates', jsonb_build_object(
          'starts_at', '2020-01-01T00:00:00Z', 'ends_at', '2030-01-01T00:00:00Z'),
        'minimum_spend', jsonb_build_object('eligible_subtotal_kobo', 1000),
        'caps', jsonb_build_object('discount_kobo', 1000000))
  WHERE partnership = 'uba_redvault';
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status)
  VALUES
    (v_application_one, v_order_one, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p1@example.com', 'R5P1-ONE', 'R5P1-ONE', 100, 150000, 'approved'),
    (v_application_two, v_order_two, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p1@example.com', 'R5P1-TWO', 'R5P1-TWO', 100, 100000, 'approved');
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, provider_response)
  VALUES
    (v_attempt_one, v_application_one, v_order_one, v_merchant, 'R5P1-ATTEMPT-ONE', v_hash,
     150000, 'NGN', 'approved', jsonb_build_object(
       'capture_amount_kobo', '150000', 'capture_reference', 'R5P1-ATTEMPT-ONE',
       'capture_currency', 'NGN', 'capture_status', 'success',
       'held_reason', 'provider_eligibility_evidence_unavailable')),
    (v_attempt_two, v_application_two, v_order_two, v_merchant, 'R5P1-ATTEMPT-TWO', v_hash,
     150000, 'NGN', 'approved', NULL);
  INSERT INTO private.uba_redvault_refunds
    (id, attempt_id, state, refund_type, idempotency_key, amount_kobo)
  VALUES
    (v_refund_a, v_attempt_one, 'processing', 'merchandise_units', 'R5P1-A', 50000),
    (v_refund_a2, v_attempt_one, 'processing', 'merchandise_units', 'R5P1-A2', 50000),
    (v_refund_c1, v_attempt_two, 'processing', 'merchandise_units', 'R5P1-C1', 50000),
    (v_refund_c2, v_attempt_two, 'processing', 'merchandise_units', 'R5P1-C2', 50000);
  INSERT INTO private.uba_redvault_refund_line_allocations
    (refund_id, application_id, order_item_id, unit_ordinal, net_amount_kobo)
  VALUES
    (v_refund_a, v_application_one, v_item_one, 1, 50000),
    (v_refund_a2, v_application_one, v_item_one, 2, 50000),
    (v_refund_c1, v_application_two, v_item_two, 1, 50000),
    (v_refund_c2, v_application_two, v_item_two, 2, 50000);

  -- Finding 3: finalizing a partial refund retains the surviving quantity.
  UPDATE private.uba_redvault_refunds SET state = 'processed' WHERE id = v_refund_a;
  SELECT inventory_state, inventory_receipt INTO v_state, v_receipt
  FROM private.uba_redvault_refund_lifecycle WHERE refund_id = v_refund_a;
  IF NOT FOUND THEN RAISE EXCEPTION 'missing lifecycle row for first refund'; END IF;
  IF v_state <> 'released' THEN
    RAISE EXCEPTION 'expected released lifecycle, got %', v_state;
  END IF;
  IF (v_receipt->>'releasedCount')::integer <> 1 THEN
    RAISE EXCEPTION 'expected releasedCount 1, got %', v_receipt;
  END IF;
  IF (SELECT fulfillment_data->>'fulfillmentQuantity' FROM public.order_items
      WHERE id = v_item_one) <> '2' THEN
    RAISE EXCEPTION 'surviving quantity lost: %',
      (SELECT fulfillment_data FROM public.order_items WHERE id = v_item_one);
  END IF;

  -- Finding 4: an active booking lock routes the release to review.
  UPDATE public.orders SET shipment_booking_lock_token = gen_random_uuid()
  WHERE id = v_order_one;
  UPDATE private.uba_redvault_refunds SET state = 'processed' WHERE id = v_refund_a2;
  SELECT inventory_state INTO v_state
  FROM private.uba_redvault_refund_lifecycle WHERE refund_id = v_refund_a2;
  IF NOT FOUND THEN RAISE EXCEPTION 'missing lifecycle row for locked refund'; END IF;
  IF v_state <> 'review_required' THEN
    RAISE EXCEPTION 'booking lock did not route to review, got %', v_state;
  END IF;
  UPDATE public.orders SET shipment_booking_lock_token = NULL
  WHERE id = v_order_one;

  -- Finding 2: two processed refunds for one order fold into a single review.
  UPDATE public.orders SET shipment_booking_lock_token = gen_random_uuid()
  WHERE id = v_order_two;
  UPDATE private.uba_redvault_refunds SET state = 'processed' WHERE id = v_refund_c1;
  UPDATE private.uba_redvault_refunds SET state = 'processed' WHERE id = v_refund_c2;
  UPDATE public.orders SET shipment_booking_lock_token = NULL
  WHERE id = v_order_two;
  SELECT count(*) INTO v_count FROM public.reconciliation_review
  WHERE issue_type = 'serialized_inventory_confirmation_failed'
    AND order_id = v_order_two AND resolved_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected 1 merged review, got %', v_count;
  END IF;
  SELECT metadata INTO v_meta FROM public.reconciliation_review
  WHERE issue_type = 'serialized_inventory_confirmation_failed'
    AND order_id = v_order_two AND resolved_at IS NULL
  LIMIT 1;
  IF NOT (v_meta->'refundIds' ? v_refund_c1::text
      AND v_meta->'refundIds' ? v_refund_c2::text) THEN
    RAISE EXCEPTION 'refundIds not merged: %', v_meta;
  END IF;

  -- P1-A: a unit tied to a processed refund cannot be refunded again, while
  -- a unit tied to a failed refund stays retryable.
  INSERT INTO private.uba_redvault_line_allocations
    (application_id, order_item_id, line_id, unit_ordinal, allocation_kobo,
     product_id, variant_id, unit_price_kobo, vat_rate_bp, tax_basis)
  VALUES
    (v_application_one, v_item_one, 1, 1, 0, v_product, v_variant, 10000, 0, 'exclusive'),
    (v_application_one, v_item_one, 2, 2, 0, v_product, v_variant, 10000, 0, 'exclusive'),
    (v_application_one, v_item_one, 3, 3, 0, v_product, v_variant, 10000, 0, 'exclusive'),
    (v_application_one, v_item_one, 4, 4, 0, v_product, v_variant, 10000, 0, 'exclusive');
  PERFORM public.reserve_uba_redvault_refund(v_attempt_one, v_merchant, 'R5P1-D1',
    'merchandise_units', '[{"orderItemId":"20000000-0000-4000-8000-000000000001","unitOrdinal":3}]'::jsonb);
  UPDATE private.uba_redvault_refunds SET state = 'processed'
  WHERE attempt_id = v_attempt_one AND idempotency_key = 'R5P1-D1';
  BEGIN
    PERFORM public.reserve_uba_redvault_refund(v_attempt_one, v_merchant, 'R5P1-D2',
      'merchandise_units', '[{"orderItemId":"20000000-0000-4000-8000-000000000001","unitOrdinal":3}]'::jsonb);
    RAISE EXCEPTION 'double refund of a processed unit was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_refund_unit_already_reserved' THEN RAISE; END IF;
  END;
  PERFORM public.reserve_uba_redvault_refund(v_attempt_one, v_merchant, 'R5P1-D3',
    'merchandise_units', '[{"orderItemId":"20000000-0000-4000-8000-000000000001","unitOrdinal":4}]'::jsonb);
  UPDATE private.uba_redvault_refunds SET state = 'processing'
  WHERE attempt_id = v_attempt_one AND idempotency_key = 'R5P1-D3';
  PERFORM public.finish_uba_redvault_refund(
    (SELECT id FROM private.uba_redvault_refunds
     WHERE attempt_id = v_attempt_one AND idempotency_key = 'R5P1-D3'),
    'failed');
  PERFORM public.reserve_uba_redvault_refund(v_attempt_one, v_merchant, 'R5P1-D4',
    'merchandise_units', '[{"orderItemId":"20000000-0000-4000-8000-000000000001","unitOrdinal":4}]'::jsonb);

  -- Finding 2 (resolver): releasing one folded refund keeps the shared
  -- review open while the other refund still needs review; releasing the
  -- last one closes it.
  v_receipt := public.resolve_uba_redvault_refund_inventory_review(v_refund_c1);
  IF (v_receipt->>'inventoryState') <> 'released' THEN
    RAISE EXCEPTION 'resolver did not release: %', v_receipt;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.reconciliation_review
             WHERE issue_type = 'serialized_inventory_confirmation_failed'
               AND order_id = v_order_two AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'shared review closed while a refund still needs review';
  END IF;
  v_receipt := public.resolve_uba_redvault_refund_inventory_review(v_refund_c2);
  IF (v_receipt->>'inventoryState') <> 'released' THEN
    RAISE EXCEPTION 'resolver did not release the second refund: %', v_receipt;
  END IF;
  IF EXISTS (SELECT 1 FROM public.reconciliation_review
             WHERE issue_type = 'serialized_inventory_confirmation_failed'
               AND order_id = v_order_two AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'merged review was not resolved after the last release';
  END IF;
  -- P1-B: capture accepts the merchant-bound scoped route client and refuses
  -- a scoped token bound to a different merchant.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'storefront_order_context', 'route',
    'storefront_order_merchant_id', '6b5cb8a4-5575-456c-b936-8cdfae30db74')::text, true);
  BEGIN
    PERFORM public.capture_or_hold_uba_redvault_payment(
      gen_random_uuid(), gen_random_uuid(), 'paystack', 'R5P1-NOPE', '{}'::jsonb);
    RAISE EXCEPTION 'scoped capture unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_capture_transaction_order_mismatch' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'role', 'authenticated', 'storefront_order_context', 'route',
    'storefront_order_merchant_id', '00000000-0000-4000-8000-000000000000')::text, true);
  BEGIN
    PERFORM public.capture_or_hold_uba_redvault_payment(
      gen_random_uuid(), gen_random_uuid(), 'paystack', 'R5P1-NOPE', '{}'::jsonb);
    RAISE EXCEPTION 'wrong-merchant capture unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'forbidden:%' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
