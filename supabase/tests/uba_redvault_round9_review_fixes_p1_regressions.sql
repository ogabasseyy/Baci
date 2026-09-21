-- Round-9 P1 regressions: reference-less indeterminate refunds stay
-- claimable through pending lookups; partial processed refunds reduce the
-- eventual settlement instead of overcrediting; abandoned cleanup cancels
-- stale drafts and releases fenced units atomically; approval blocks while a
-- refund needs reconciliation.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_order_a uuid := '10000000-0000-4000-8000-000000000051';
  v_order_b uuid := '10000000-0000-4000-8000-000000000052';
  v_order_c uuid := '10000000-0000-4000-8000-000000000054';
  v_order_stale uuid := '10000000-0000-4000-8000-000000000053';
  v_application_a uuid := 'd1000000-0000-4000-8000-000000000051';
  v_application_b uuid := 'd1000000-0000-4000-8000-000000000052';
  v_application_c uuid := 'd1000000-0000-4000-8000-000000000053';
  v_attempt_a uuid := 'd2000000-0000-4000-8000-000000000051';
  v_attempt_b uuid := 'd2000000-0000-4000-8000-000000000052';
  v_attempt_c uuid := 'd2000000-0000-4000-8000-000000000053';
  v_refund_a uuid := 'e1000000-0000-4000-8000-000000000051';
  v_refund_b uuid := 'e1000000-0000-4000-8000-000000000052';
  v_refund_c uuid := 'e1000000-0000-4000-8000-000000000053';
  v_refund_d uuid := 'e1000000-0000-4000-8000-000000000054';
  v_discount uuid := 'f0000000-0000-4000-8000-000000000051';
  v_wallet uuid := 'f1000000-0000-4000-8000-000000000051';
  v_product uuid := 'b0000000-0000-4000-8000-000000000051';
  v_variant uuid := 'c0000000-0000-4000-8000-000000000051';
  v_item_stale uuid := '20000000-0000-4000-8000-000000000051';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_claim_id uuid;
  v_token uuid;
  v_state text;
  v_net numeric;
  v_upcoming numeric;
  v_meta jsonb;
  v_n integer;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p9@example.com', 'Redvault P9')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R9P1', 'fixed_amount', 100);
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
  INSERT INTO public.orders (id, merchant_id, order_number, total, payment_method)
  VALUES (v_order_a, v_merchant, 'R9P1-A', 1500.00, 'uba_redvault'),
         (v_order_b, v_merchant, 'R9P1-B', 1500.00, 'uba_redvault'),
         (v_order_c, v_merchant, 'R9P1-C', 1500.00, 'uba_redvault');
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status)
  VALUES
    (v_application_a, v_order_a, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p9@example.com', 'R9P1-A', 'R9P1-A', 100, 150000, 'pending'),
    (v_application_b, v_order_b, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p9@example.com', 'R9P1-B', 'R9P1-B', 100, 150000, 'pending'),
    (v_application_c, v_order_c, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p9@example.com', 'R9P1-C', 'R9P1-C', 100, 150000, 'pending');
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state)
  VALUES
    (v_attempt_a, v_application_a, v_order_a, v_merchant, 'R9P1-ATTEMPT-A', v_hash,
     150000, 'NGN', 'created'),
    (v_attempt_b, v_application_b, v_order_b, v_merchant, 'R9P1-ATTEMPT-B', v_hash,
     150000, 'NGN', 'created'),
    (v_attempt_c, v_application_c, v_order_c, v_merchant, 'R9P1-ATTEMPT-C', v_hash,
     150000, 'NGN', 'created');
  INSERT INTO private.uba_redvault_refunds (id, attempt_id, state, refund_type, idempotency_key, amount_kobo)
  VALUES
    (v_refund_a, v_attempt_a, 'needs_reconciliation', 'merchandise_units', 'R9P1-A', 10000),
    (v_refund_b, v_attempt_b, 'processed', 'merchandise_units', 'R9P1-B', 40000),
    (v_refund_c, v_attempt_b, 'failed', 'merchandise_units', 'R9P1-C', 110000),
    (v_refund_d, v_attempt_c, 'processed', 'merchandise_units', 'R9P1-D', 150000);

  -- P1 (indeterminate): a pending lookup keeps the reference-less row in
  -- needs_reconciliation with a cleared lease, so it is claimed again.
  SELECT id, reconciliation_claim_token INTO v_claim_id, v_token
  FROM public.claim_next_uba_redvault_refund_reconciliation();
  IF v_claim_id <> v_refund_a THEN
    RAISE EXCEPTION 'indeterminate refund was not claimed first, got %', v_claim_id;
  END IF;
  PERFORM public.reconcile_uba_redvault_refund(v_claim_id, v_token, 'pending');
  SELECT state INTO v_state FROM private.uba_redvault_refunds WHERE id = v_refund_a;
  IF v_state <> 'needs_reconciliation' THEN
    RAISE EXCEPTION 'pending lookup moved the row to %, expected needs_reconciliation', v_state;
  END IF;
  SELECT id, reconciliation_claim_token INTO v_claim_id, v_token
  FROM public.claim_next_uba_redvault_refund_reconciliation();
  IF v_claim_id <> v_refund_a THEN
    RAISE EXCEPTION 'row was not re-claimable, got %', v_claim_id;
  END IF;
  PERFORM public.reconcile_uba_redvault_refund(v_claim_id, v_token, 'failed');
  SELECT state INTO v_state FROM private.uba_redvault_refunds WHERE id = v_refund_a;
  IF v_state <> 'failed' THEN
    RAISE EXCEPTION 'terminal lookup did not finalize, got %', v_state;
  END IF;

  -- P1 (settlement): a processed partial reduces the eventual settlement.
  PERFORM public.record_merchant_settlement(v_merchant, 'order', v_order_b, 'paystack',
    'R9P1-ATTEMPT-B', 1500.00, 0, 0, 'test', '{}'::jsonb);
  SELECT net_amount, metadata INTO v_net, v_meta FROM public.merchant_settlements
  WHERE source_id = v_order_b AND gateway_reference = 'R9P1-ATTEMPT-B';
  IF v_net <> 1100.00 THEN
    RAISE EXCEPTION 'settlement was not reduced by the partial refund, got %', v_net;
  END IF;
  IF (v_meta->>'redvault_partial_refund_reduction_kobo')::bigint <> 40000 THEN
    RAISE EXCEPTION 'reduction audit missing: %', v_meta;
  END IF;
  SELECT upcoming_balance INTO v_upcoming FROM public.merchant_wallets WHERE id = v_wallet;
  IF v_upcoming <> 1100.00 THEN
    RAISE EXCEPTION 'wallet credited unreduced amount, got %', v_upcoming;
  END IF;

  -- A fully processed capture still suppresses the settlement entirely.
  PERFORM public.record_merchant_settlement(v_merchant, 'order', v_order_c, 'paystack',
    'R9P1-ATTEMPT-C', 1500.00, 0, 0, 'test', '{}'::jsonb);
  SELECT count(*) INTO v_n FROM public.merchant_settlements
  WHERE source_id = v_order_c;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'fully refunded settlement was not suppressed, got % rows', v_n;
  END IF;

  -- P1 (abandoned cleanup): the batch cancels the stale draft and releases
  -- its fenced unit atomically, without calling the RPC.
  INSERT INTO public.products (id, merchant_id, name, price, has_variants, inventory_tracking_policy)
  VALUES (v_product, v_merchant, 'Redvault P9 product', 150000, true, 'serialized_strict');
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy)
  VALUES (v_variant, v_product, v_merchant, 'inherit');
  INSERT INTO public.orders (id, merchant_id, order_number, total, payment_method, created_at)
  VALUES (v_order_stale, v_merchant, 'R9P1-STALE', 1500.00, 'uba_redvault', pg_catalog.now() - interval '100 hours');
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES (v_item_stale, v_order_stale, v_product, v_variant, 'Redvault P9 item', 150000, 1);
  INSERT INTO public.variant_inventory
    (id, merchant_id, order_id, order_item_id, variant_id, status, identifier_type, identifier_value)
  VALUES
    ('a0000000-0000-4000-8000-000000000051', v_merchant, v_order_stale, v_item_stale, v_variant, 'reserved', 'serial', 'R9P2-001');
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
  UPDATE public.orders SET payment_status = 'cancelled', updated_at = pg_catalog.now()
  WHERE created_at < (pg_catalog.now() - interval '72 hours')
    AND payment_status = 'unpaid';
  SELECT payment_status INTO v_state FROM public.orders WHERE id = v_order_stale;
  IF v_state <> 'cancelled' THEN
    RAISE EXCEPTION 'stale draft was not cancelled, got %', v_state;
  END IF;
  SELECT status INTO v_state FROM public.variant_inventory
  WHERE id = 'a0000000-0000-4000-8000-000000000051';
  IF v_state <> 'available' THEN
    RAISE EXCEPTION 'fenced unit was not released by cleanup, got %', v_state;
  END IF;

  -- P1 (approval block): a needs_reconciliation refund blocks capture approval.
  -- Re-enter the protected path: the cleanup leg above deleted the write
  -- context to mimic the worker, but order writes ride it like production.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.orders (id, merchant_id, order_number, total, payment_method, customer_email)
  VALUES ('10000000-0000-4000-8000-000000000055', v_merchant, 'R9P1-D', 1500.00, 'uba_redvault', 'redvault-p9@example.com');
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status)
  VALUES
    ('d1000000-0000-4000-8000-000000000055', '10000000-0000-4000-8000-000000000055', v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p9@example.com', 'R9P1-D', 'R9P1-D', 100, 150000, 'pending');
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, provider_response,
     accepted_filter_policy, accepted_filter_policy_hash)
  VALUES
    ('d2000000-0000-4000-8000-000000000055', 'd1000000-0000-4000-8000-000000000055', '10000000-0000-4000-8000-000000000055', v_merchant, 'R9P1-ATTEMPT-D', v_hash,
     150000, 'NGN', 'captured_held', jsonb_build_object(
       'capture_amount_kobo', '150000', 'capture_reference', 'R9P1-ATTEMPT-D',
       'capture_currency', 'NGN', 'capture_status', 'success'),
     jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
       'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard')),
     encode(extensions.digest(jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
       'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'))::text, 'sha256'), 'hex'));
  INSERT INTO public.transactions
    (id, merchant_id, order_id, transaction_type, amount, currency, status, gateway, gateway_reference, platform_fee)
  VALUES
    ('d3000000-0000-4000-8000-000000000055', v_merchant, '10000000-0000-4000-8000-000000000055', 'payment', 1500.00, 'NGN', 'pending', 'paystack', 'R9P1-ATTEMPT-D', NULL);
  INSERT INTO private.uba_redvault_refunds (id, attempt_id, state, refund_type, idempotency_key, amount_kobo)
  VALUES
    ('e1000000-0000-4000-8000-000000000055', 'd2000000-0000-4000-8000-000000000055', 'needs_reconciliation', 'merchandise_units', 'R9P1-E', 10000);
  BEGIN
    PERFORM public.approve_and_complete_uba_redvault_payment(
      'd3000000-0000-4000-8000-000000000055', '10000000-0000-4000-8000-000000000055',
      jsonb_build_object(
        'acceptedFilterPolicyHash', (SELECT accepted_filter_policy_hash FROM private.uba_redvault_payment_attempts WHERE id = 'd2000000-0000-4000-8000-000000000055'),
        'amountKobo', 150000, 'cardBrand', 'verve', 'cardChannel', 'card',
        'contractVersion', 'paystack_verified_card_v1', 'currency', 'NGN',
        'customerEmail', 'redvault-p9@example.com', 'domain', 'test',
        'issuerName', 'GTBank', 'providerVerificationId', 'R9P1-PROV-D',
        'reference', 'R9P1-ATTEMPT-D',
        'verificationSource', 'paystack_transaction_verify',
        'verifiedAt', '2026-01-01T00:00:00Z'));
    RAISE EXCEPTION 'approval with needs_reconciliation refund unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_verified_completion_refund_pending' THEN RAISE; END IF;
  END;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
