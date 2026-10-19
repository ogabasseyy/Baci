-- Round-29 P1 regressions: the shipment-booking claim rejects while a
-- partial REDVAULT refund is still settling (payment_status stays paid, so
-- the refunded check cannot see it), and refund reservation rejects while
-- a live booking lock is held. Together they mutually exclude booking and
-- refund settlement.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_customer uuid := '22222222-0000-4000-8000-0000000000d1';
  v_order_blocked uuid := '10000000-0000-4000-8000-0000000000d1';
  v_order_review uuid := '10000000-0000-4000-8000-0000000000d2';
  v_order_locked uuid := '10000000-0000-4000-8000-0000000000d3';
  v_order_stale uuid := '10000000-0000-4000-8000-0000000000d4';
  v_application_blocked uuid := 'd1000000-0000-4000-8000-0000000000d1';
  v_application_review uuid := 'd1000000-0000-4000-8000-0000000000d2';
  v_application_locked uuid := 'd1000000-0000-4000-8000-0000000000d3';
  v_application_stale uuid := 'd1000000-0000-4000-8000-0000000000d4';
  v_attempt_blocked uuid := 'd2000000-0000-4000-8000-0000000000d1';
  v_attempt_review uuid := 'd2000000-0000-4000-8000-0000000000d2';
  v_attempt_locked uuid := 'd2000000-0000-4000-8000-0000000000d3';
  v_attempt_stale uuid := 'd2000000-0000-4000-8000-0000000000d4';
  v_refund_pending uuid := 'd3000000-0000-4000-8000-0000000000d1';
  v_refund_review uuid := 'd3000000-0000-4000-8000-0000000000d2';
  v_discount uuid := 'f0000000-0000-4000-8000-0000000000d1';
  v_wallet uuid := 'f1000000-0000-4000-8000-0000000000d1';
  v_product uuid := 'b0000000-0000-4000-8000-0000000000d1';
  v_variant uuid := 'c0000000-0000-4000-8000-0000000000d1';
  v_item uuid := '20000000-0000-4000-8000-0000000000d1';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_evidence jsonb := '{"capture_reference":"R29P1","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success"}'::jsonb;
  v_claimed boolean;
  v_state text;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p29@example.com', 'Redvault P29')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R29P1', 'fixed_amount', 100);
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
  VALUES (v_product, v_merchant, 'Redvault P29 product', 150000, true, 'serialized_strict');
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy, attributes)
  VALUES (v_variant, v_product, v_merchant, 'inherit', '{"color":"red"}'::jsonb);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer, v_merchant, NULL, 'redvault-p29@example.com');

  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, total, payment_method, payment_status, shipping_status,
     tracking_token, created_at)
  VALUES
    (v_order_blocked, v_merchant, v_customer, 'R29P1-BLOCKED', 1500.00, 'uba_redvault', 'paid', 'pending',
     'track-r29-blocked', pg_catalog.now() - interval '10 minutes'),
    (v_order_review, v_merchant, v_customer, 'R29P1-REVIEW', 1500.00, 'uba_redvault', 'paid', 'pending',
     'track-r29-review', pg_catalog.now() - interval '10 minutes'),
    (v_order_locked, v_merchant, v_customer, 'R29P1-LOCKED', 1500.00, 'uba_redvault', 'paid', 'pending',
     'track-r29-locked', pg_catalog.now() - interval '10 minutes'),
    (v_order_stale, v_merchant, v_customer, 'R29P1-STALE', 1500.00, 'uba_redvault', 'paid', 'pending',
     'track-r29-stale', pg_catalog.now() - interval '10 minutes');
  -- A live booking lock (fresh token) versus a stale one (older than the
  -- 900s claim timeout, which the claim itself would steal).
  UPDATE public.orders
  SET shipment_booking_lock_token = gen_random_uuid(), shipment_booking_started_at = pg_catalog.now()
  WHERE id = v_order_locked;
  UPDATE public.orders
  SET shipment_booking_lock_token = gen_random_uuid(),
      shipment_booking_started_at = pg_catalog.now() - interval '20 minutes'
  WHERE id = v_order_stale;
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES (v_item, v_order_stale, v_product, v_variant, 'Redvault P29 item', 150000, 2);
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status, user_id)
  VALUES
    (v_application_blocked, v_order_blocked, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p29@example.com', 'R29P1-BLOCKED', 'R29P1-BLOCKED', 100, 150000, 'pending', NULL),
    (v_application_review, v_order_review, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p29@example.com', 'R29P1-REVIEW', 'R29P1-REVIEW', 100, 150000, 'pending', NULL),
    (v_application_locked, v_order_locked, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p29@example.com', 'R29P1-LOCKED', 'R29P1-LOCKED', 100, 150000, 'pending', NULL),
    (v_application_stale, v_order_stale, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p29@example.com', 'R29P1-STALE', 'R29P1-STALE', 100, 150000, 'pending', NULL);
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash,
     paystack_subaccount_code, platform_fee_kobo, authorization_url, provider_response)
  VALUES
    (v_attempt_blocked, v_application_blocked, v_order_blocked, v_merchant, 'R29P1-ATTEMPT-BLOCKED', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r29p1', 0, NULL, v_evidence),
    (v_attempt_review, v_application_review, v_order_review, v_merchant, 'R29P1-ATTEMPT-REVIEW', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r29p1', 0, NULL, v_evidence),
    (v_attempt_locked, v_application_locked, v_order_locked, v_merchant, 'R29P1-ATTEMPT-LOCKED', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r29p1', 0, NULL, v_evidence),
    (v_attempt_stale, v_application_stale, v_order_stale, v_merchant, 'R29P1-ATTEMPT-STALE', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r29p1', 0, NULL,
     '{"capture_reference":"R29P1-ATTEMPT-STALE","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb);
  INSERT INTO private.uba_redvault_line_allocations
    (application_id, order_item_id, line_id, unit_ordinal, allocation_kobo,
     product_id, variant_id, unit_price_kobo, vat_rate_bp, tax_basis)
  VALUES
    (v_application_stale, v_item, 1, 1, 0, v_product, v_variant, 75000, 0, 'exclusive'),
    (v_application_stale, v_item, 1, 2, 0, v_product, v_variant, 75000, 0, 'exclusive');
  INSERT INTO private.uba_redvault_refunds (id, attempt_id, idempotency_key, amount_kobo, state, refund_type)
  VALUES
    (v_refund_pending, v_attempt_blocked, 'R29P1-PENDING', 75000, 'pending', 'merchandise_units'),
    (v_refund_review, v_attempt_review, 'R29P1-REVIEW', 75000, 'processed', 'merchandise_units');
  INSERT INTO private.uba_redvault_refund_lifecycle
    (refund_id, order_id, financial_state, inventory_state, review_reason, inventory_receipt)
  VALUES (v_refund_review, v_order_review, 'refunded', 'review_required', 'inventory_release_requires_review', NULL);
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- Claim rejects while a partial refund is pending or processed but
  -- unreconciled, and succeeds once the partial settles to released.
  BEGIN
    PERFORM public.claim_order_shipment_booking(v_order_blocked, v_merchant, gen_random_uuid());
    RAISE EXCEPTION 'claim with a pending partial unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_refund_pending_for_shipment' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.claim_order_shipment_booking(v_order_review, v_merchant, gen_random_uuid());
    RAISE EXCEPTION 'claim with an unreconciled partial unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_refund_pending_for_shipment' THEN RAISE; END IF;
  END;
  UPDATE private.uba_redvault_refunds SET state = 'processed' WHERE id = v_refund_pending;
  INSERT INTO private.uba_redvault_refund_lifecycle
    (refund_id, order_id, financial_state, inventory_state, review_reason, inventory_receipt)
  VALUES (v_refund_pending, v_order_blocked, 'refunded', 'released', NULL, '{}'::jsonb);
  SELECT claimed INTO v_claimed
  FROM public.claim_order_shipment_booking(v_order_blocked, v_merchant, gen_random_uuid());
  IF v_claimed IS NOT TRUE THEN RAISE EXCEPTION 'claim after settlement failed'; END IF;

  -- Reservation rejects while a live booking lock is held, but a stale
  -- lock does not block: the merchandise reservation succeeds normally.
  BEGIN
    PERFORM public.reserve_uba_redvault_refund(v_attempt_locked, v_merchant, 'R29P1-LOCKED',
      'merchandise_units',
      jsonb_build_array(jsonb_build_object('orderItemId', v_item::text, 'unitOrdinal', 1)));
    RAISE EXCEPTION 'reservation under a live booking lock unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_refund_booking_in_progress' THEN RAISE; END IF;
  END;
  SELECT state INTO v_state FROM public.reserve_uba_redvault_refund(v_attempt_stale, v_merchant,
    'R29P1-STALE', 'merchandise_units',
    jsonb_build_array(jsonb_build_object('orderItemId', v_item::text, 'unitOrdinal', 1)));
  IF v_state <> 'pending' THEN
    RAISE EXCEPTION 'reservation under a stale lock did not succeed, got %', v_state;
  END IF;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
