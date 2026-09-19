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
  v_refund_c1 uuid := 'e1000000-0000-4000-8000-000000000002';
  v_refund_c2 uuid := 'e1000000-0000-4000-8000-000000000003';
  v_discount uuid := 'f0000000-0000-4000-8000-000000000001';
  v_hash text := '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  v_receipt jsonb;
  v_count integer;
  v_meta jsonb;
BEGIN
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
     amount_kobo, currency, state)
  VALUES
    (v_attempt_one, v_application_one, v_order_one, v_merchant, 'R5P1-ATTEMPT-ONE', v_hash,
     150000, 'NGN', 'approved'),
    (v_attempt_two, v_application_two, v_order_two, v_merchant, 'R5P1-ATTEMPT-TWO', v_hash,
     100000, 'NGN', 'approved');
  INSERT INTO private.uba_redvault_refunds
    (id, attempt_id, state, refund_type, idempotency_key, amount_kobo)
  VALUES
    (v_refund_a, v_attempt_one, 'processed', 'merchandise_units', 'R5P1-A', 50000),
    (v_refund_c1, v_attempt_two, 'processed', 'merchandise_units', 'R5P1-C1', 50000),
    (v_refund_c2, v_attempt_two, 'processed', 'merchandise_units', 'R5P1-C2', 50000);
  INSERT INTO private.uba_redvault_refund_line_allocations
    (refund_id, application_id, order_item_id, unit_ordinal, net_amount_kobo)
  VALUES
    (v_refund_a, v_application_one, v_item_one, 1, 50000),
    (v_refund_c1, v_application_two, v_item_two, 1, 50000),
    (v_refund_c2, v_application_two, v_item_two, 2, 50000);

  -- Finding 3 + 4 (control): release succeeds and retains the surviving count.
  v_receipt := private.release_redvault_refund_inventory_units(v_refund_a);
  IF (v_receipt->>'releasedCount')::integer <> 1 THEN
    RAISE EXCEPTION 'expected releasedCount 1, got %', v_receipt;
  END IF;
  IF (SELECT fulfillment_data->>'fulfillmentQuantity' FROM public.order_items
      WHERE id = v_item_one) <> '2' THEN
    RAISE EXCEPTION 'surviving quantity lost: %',
      (SELECT fulfillment_data FROM public.order_items WHERE id = v_item_one);
  END IF;

  -- Finding 4: an active booking lock must route the release to review.
  UPDATE public.orders SET shipment_booking_lock_token = gen_random_uuid()
  WHERE id = v_order_one;
  BEGIN
    PERFORM private.release_redvault_refund_inventory_units(v_refund_a);
    RAISE EXCEPTION 'booking lock guard did not fire';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_partial_refund_inventory_requires_review' THEN RAISE; END IF;
  END;
  UPDATE public.orders SET shipment_booking_lock_token = NULL
  WHERE id = v_order_one;

  -- Finding 2: two refunds for one order fold into a single open review.
  INSERT INTO private.uba_redvault_refund_lifecycle
    (refund_id, order_id, financial_state, inventory_state, review_reason, inventory_receipt)
  VALUES (v_refund_c1, v_order_two, 'review_required', 'review_required',
      'first refund needs review', '{"step":1}'::jsonb),
         (v_refund_c2, v_order_two, 'review_required', 'review_required',
      'second refund needs review', '{"step":2}'::jsonb);
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

  -- Finding 2 (resolver): releasing one folded refund resolves the open review.
  v_receipt := public.resolve_uba_redvault_refund_inventory_review(v_refund_c1);
  IF (v_receipt->>'inventoryState') <> 'released' THEN
    RAISE EXCEPTION 'resolver did not release: %', v_receipt;
  END IF;
  IF EXISTS (SELECT 1 FROM public.reconciliation_review
             WHERE issue_type = 'serialized_inventory_confirmation_failed'
               AND order_id = v_order_two AND resolved_at IS NULL) THEN
    RAISE EXCEPTION 'merged review was not resolved';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
