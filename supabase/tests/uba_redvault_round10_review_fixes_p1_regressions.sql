-- Round-10 P1 regressions: held captures survive abandoned cleanup; late
-- settlements reduce the proportional net share (not gross) and persist the
-- reversal bookkeeping; the reconciliation claim carries submission time and
-- sibling provider references for capture-reference correlation.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_order_held uuid := '10000000-0000-4000-8000-000000000061';
  v_order_active_refund uuid := '10000000-0000-4000-8000-000000000062';
  v_order_approved uuid := '10000000-0000-4000-8000-000000000063';
  v_order_plain uuid := '10000000-0000-4000-8000-000000000064';
  v_order_fee uuid := '10000000-0000-4000-8000-000000000065';
  v_application_held uuid := 'd1000000-0000-4000-8000-000000000061';
  v_application_active uuid := 'd1000000-0000-4000-8000-000000000062';
  v_application_approved uuid := 'd1000000-0000-4000-8000-000000000063';
  v_application_fee uuid := 'd1000000-0000-4000-8000-000000000065';
  v_attempt_held uuid := 'd2000000-0000-4000-8000-000000000061';
  v_attempt_active uuid := 'd2000000-0000-4000-8000-000000000062';
  v_attempt_approved uuid := 'd2000000-0000-4000-8000-000000000063';
  v_attempt_fee uuid := 'd2000000-0000-4000-8000-000000000065';
  v_refund_active uuid := 'e1000000-0000-4000-8000-000000000062';
  v_refund_fee_a uuid := 'e1000000-0000-4000-8000-000000000065';
  v_refund_fee_b uuid := 'e1000000-0000-4000-8000-000000000066';
  v_discount uuid := 'f0000000-0000-4000-8000-000000000061';
  v_wallet uuid := 'f1000000-0000-4000-8000-000000000061';
  v_product uuid := 'b0000000-0000-4000-8000-000000000061';
  v_variant uuid := 'c0000000-0000-4000-8000-000000000061';
  v_item_held uuid := '20000000-0000-4000-8000-000000000061';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_claim_id uuid;
  v_token uuid;
  v_state text;
  v_status text;
  v_siblings text[];
  v_submitted timestamptz;
  v_net numeric;
  v_upcoming numeric;
  v_meta jsonb;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p10@example.com', 'Redvault P10')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R10P1', 'fixed_amount', 100);
  -- Mirror ops activation so applications pass commercial-terms validation.
  UPDATE private.uba_redvault_runtime
  SET commercial_terms_confirmed = true,
      commercial_terms = jsonb_build_object(
        'campaign_dates', jsonb_build_object(
          'starts_at', '2020-01-01T00:00:00Z', 'ends_at', '2030-01-01T00:00:00Z'),
        'minimum_spend', jsonb_build_object('eligible_subtotal_kobo', 1000),
        'caps', jsonb_build_object('discount_kobo', 1000000),
        'usage_limits', jsonb_build_object(
          'usage_limit', 1000000, 'usage_limit_per_customer', 1000000))
  WHERE partnership = 'uba_redvault';
  INSERT INTO public.products (id, merchant_id, name, price, has_variants, inventory_tracking_policy)
  VALUES (v_product, v_merchant, 'Redvault P10 product', 150000, true, 'serialized_strict');
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy, attributes)
  VALUES (v_variant, v_product, v_merchant, 'inherit', '{"color":"red","storage":"128GB"}'::jsonb);

  -- P1 (held cleanup): stale drafts with a held/approved capture or an
  -- active refund keep the shopper's money, so the generic batch must leave
  -- them unpaid (and fenced) while a plain stale draft still cancels.
  INSERT INTO public.orders (id, merchant_id, order_number, total, payment_method, created_at)
  VALUES (v_order_held, v_merchant, 'R10P1-HELD', 1500.00, 'uba_redvault', pg_catalog.now() - interval '100 hours'),
         (v_order_active_refund, v_merchant, 'R10P1-ACTIVE', 1500.00, 'uba_redvault', pg_catalog.now() - interval '100 hours'),
         (v_order_approved, v_merchant, 'R10P1-APPROVED', 1500.00, 'uba_redvault', pg_catalog.now() - interval '100 hours'),
         (v_order_plain, v_merchant, 'R10P1-PLAIN', 1500.00, 'uba_redvault', pg_catalog.now() - interval '100 hours');
  -- Items/units land before the applications: the snapshot-immutability
  -- guard rejects item writes once an application exists for the order.
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES (v_item_held, v_order_held, v_product, v_variant, 'Redvault P10 item', 150000, 1);
  INSERT INTO public.variant_inventory
    (id, merchant_id, order_id, order_item_id, variant_id, status, identifier_type, identifier_value)
  VALUES
    ('a0000000-0000-4000-8000-000000000061', v_merchant, v_order_held, v_item_held, v_variant, 'reserved', 'serial', 'R10P2-001');
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status)
  VALUES
    (v_application_held, v_order_held, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p10@example.com', 'R10P1-HELD', 'R10P1-HELD', 100, 150000, 'pending'),
    (v_application_active, v_order_active_refund, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p10@example.com', 'R10P1-ACTIVE', 'R10P1-ACTIVE', 100, 150000, 'pending'),
    (v_application_approved, v_order_approved, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p10@example.com', 'R10P1-APPROVED', 'R10P1-APPROVED', 100, 150000, 'pending');
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state)
  VALUES
    (v_attempt_held, v_application_held, v_order_held, v_merchant, 'R10P1-ATTEMPT-HELD', v_hash,
     150000, 'NGN', 'captured_held'),
    (v_attempt_active, v_application_active, v_order_active_refund, v_merchant, 'R10P1-ATTEMPT-ACTIVE', v_hash,
     150000, 'NGN', 'created'),
    (v_attempt_approved, v_application_approved, v_order_approved, v_merchant, 'R10P1-ATTEMPT-APPROVED', v_hash,
     150000, 'NGN', 'approved');
  INSERT INTO private.uba_redvault_refunds (id, attempt_id, state, refund_type, idempotency_key, amount_kobo)
  VALUES
    (v_refund_active, v_attempt_active, 'needs_reconciliation', 'merchandise_units', 'R10P1-ACTIVE', 10000);
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
  UPDATE public.orders SET payment_status = 'cancelled', updated_at = pg_catalog.now()
  WHERE created_at < (pg_catalog.now() - interval '72 hours')
    AND payment_status = 'unpaid';
  SELECT payment_status INTO v_state FROM public.orders WHERE id = v_order_held;
  IF v_state <> 'unpaid' THEN
    RAISE EXCEPTION 'held capture was cancelled, got %', v_state;
  END IF;
  SELECT status INTO v_status FROM public.variant_inventory
  WHERE id = 'a0000000-0000-4000-8000-000000000061';
  IF v_status <> 'reserved' THEN
    RAISE EXCEPTION 'held capture units were released, got %', v_status;
  END IF;
  SELECT payment_status INTO v_state FROM public.orders WHERE id = v_order_active_refund;
  IF v_state <> 'unpaid' THEN
    RAISE EXCEPTION 'order with active refund was cancelled, got %', v_state;
  END IF;
  SELECT payment_status INTO v_state FROM public.orders WHERE id = v_order_approved;
  IF v_state <> 'unpaid' THEN
    RAISE EXCEPTION 'approved capture was cancelled, got %', v_state;
  END IF;
  SELECT payment_status INTO v_state FROM public.orders WHERE id = v_order_plain;
  IF v_state <> 'cancelled' THEN
    RAISE EXCEPTION 'plain stale draft was not cancelled, got %', v_state;
  END IF;

  -- P1 (proportional settlement): a 400.00 partial on a 1500.00 capture with
  -- a 100.00 gateway fee settles 1400.00 - round(1400.00 * 40000/150000) =
  -- 1026.67 (not 1000.00), persists the reversal bookkeeping, and a second
  -- 300.00 partial reverses the remainder off the persisted books.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.orders (id, merchant_id, order_number, total, payment_method, payment_status)
  VALUES (v_order_fee, v_merchant, 'R10P1-FEE', 1500.00, 'uba_redvault', 'paid');
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status)
  VALUES
    (v_application_fee, v_order_fee, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p10@example.com', 'R10P1-FEE', 'R10P1-FEE', 100, 150000, 'pending');
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state)
  VALUES
    (v_attempt_fee, v_application_fee, v_order_fee, v_merchant, 'R10P1-ATTEMPT-FEE', v_hash,
     150000, 'NGN', 'created');
  INSERT INTO private.uba_redvault_refunds (id, attempt_id, state, refund_type, idempotency_key, amount_kobo)
  VALUES
    (v_refund_fee_a, v_attempt_fee, 'processed', 'merchandise_units', 'R10P1-FEE-A', 40000);
  INSERT INTO public.transactions
    (id, merchant_id, order_id, transaction_type, amount, currency, status, gateway, gateway_reference, platform_fee)
  VALUES
    ('d3000000-0000-4000-8000-000000000065', v_merchant, v_order_fee, 'payment', 1500.00, 'NGN', 'completed', 'paystack', 'R10P1-ATTEMPT-FEE', NULL);
  PERFORM public.record_merchant_settlement(v_merchant, 'order', v_order_fee, 'paystack',
    'R10P1-ATTEMPT-FEE', 1500.00, 100, 0, 'test', '{}'::jsonb);
  SELECT net_amount, metadata INTO v_net, v_meta FROM public.merchant_settlements
  WHERE source_id = v_order_fee;
  IF v_net <> 1026.67 THEN
    RAISE EXCEPTION 'settlement was not reduced proportionally, got %', v_net;
  END IF;
  IF (v_meta->>'redvault_original_net_amount')::numeric <> 1400.00 THEN
    RAISE EXCEPTION 'original net was not persisted: %', v_meta;
  END IF;
  IF (v_meta->>'redvault_reversed_net_amount')::numeric <> 373.33 THEN
    RAISE EXCEPTION 'reversed net was not persisted: %', v_meta;
  END IF;
  IF NOT (v_meta->'redvault_processed_refund_ids' ? v_refund_fee_a::text) THEN
    RAISE EXCEPTION 'processed refund id was not persisted: %', v_meta;
  END IF;
  IF (v_meta->>'redvault_partial_refund_reduction_kobo')::bigint <> 40000 THEN
    RAISE EXCEPTION 'reduction audit missing: %', v_meta;
  END IF;
  SELECT upcoming_balance INTO v_upcoming FROM public.merchant_wallets WHERE id = v_wallet;
  IF v_upcoming <> 1026.67 THEN
    RAISE EXCEPTION 'wallet was not credited the reduced net, got %', v_upcoming;
  END IF;
  INSERT INTO private.uba_redvault_refunds (id, attempt_id, state, refund_type, idempotency_key, amount_kobo)
  VALUES
    (v_refund_fee_b, v_attempt_fee, 'processed', 'merchandise_units', 'R10P1-FEE-B', 30000);
  SELECT net_amount, metadata INTO v_net, v_meta FROM public.merchant_settlements
  WHERE source_id = v_order_fee;
  IF v_net <> 746.67 THEN
    RAISE EXCEPTION 'second refund did not compound off persisted books, got %', v_net;
  END IF;
  IF (v_meta->>'redvault_reversed_net_amount')::numeric <> 653.33 THEN
    RAISE EXCEPTION 'compounded reversed net wrong: %', v_meta;
  END IF;
  IF NOT (v_meta->'redvault_processed_refund_ids' ? v_refund_fee_b::text) THEN
    RAISE EXCEPTION 'second refund id was not persisted: %', v_meta;
  END IF;
  SELECT upcoming_balance INTO v_upcoming FROM public.merchant_wallets WHERE id = v_wallet;
  IF v_upcoming <> 746.67 THEN
    RAISE EXCEPTION 'wallet was not debited the remainder, got %', v_upcoming;
  END IF;

  -- P1 (claim correlation): the claim carries the local submission time and
  -- the sibling provider references for the capture-reference lookup.
  INSERT INTO private.uba_redvault_refunds (id, attempt_id, state, refund_type, idempotency_key, amount_kobo, provider_reference)
  VALUES
    ('e1000000-0000-4000-8000-000000000067', v_attempt_active, 'failed', 'merchandise_units', 'R10P1-SIB', 10000, '777');
  SELECT id, reconciliation_claim_token, submitted_at, sibling_provider_references
  INTO v_claim_id, v_token, v_submitted, v_siblings
  FROM public.claim_next_uba_redvault_refund_reconciliation();
  IF v_claim_id <> v_refund_active THEN
    RAISE EXCEPTION 'expected the active refund claim, got %', v_claim_id;
  END IF;
  IF v_submitted IS NULL THEN
    RAISE EXCEPTION 'claim did not carry the submission time';
  END IF;
  IF NOT (v_siblings @> ARRAY['777']) THEN
    RAISE EXCEPTION 'claim did not carry sibling provider references: %', v_siblings;
  END IF;
  PERFORM public.reconcile_uba_redvault_refund(v_claim_id, v_token, 'failed');
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
