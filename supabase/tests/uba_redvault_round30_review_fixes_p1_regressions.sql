-- Round-30 P1 regressions: shipment-booking claims (and the pre-submit
-- payment assertion) reject cancelled orders; refund reservation joins the
-- order advisory-lock protocol; and full_capture remainder resolution
-- restocks only quantities no released partial has already restored.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db75';
  v_customer uuid := '22222222-0000-4000-8000-0000000000e1';
  v_order_cancel_pay uuid := '10000000-0000-4000-8000-0000000000e1';
  v_order_cancel_ship uuid := '10000000-0000-4000-8000-0000000000e2';
  v_order_canceled_us uuid := '10000000-0000-4000-8000-0000000000e3';
  v_order_refunded uuid := '10000000-0000-4000-8000-0000000000e4';
  v_order_ok uuid := '10000000-0000-4000-8000-0000000000e5';
  v_order_rsv uuid := '10000000-0000-4000-8000-0000000000e6';
  v_order_seq uuid := '10000000-0000-4000-8000-0000000000e7';
  v_order_full uuid := '10000000-0000-4000-8000-0000000000e8';
  v_order_ser uuid := '10000000-0000-4000-8000-0000000000e9';
  v_order_rev uuid := '10000000-0000-4000-8000-0000000000ea';
  v_application_rsv uuid := 'd1000000-0000-4000-8000-0000000000e1';
  v_application_seq uuid := 'd1000000-0000-4000-8000-0000000000e2';
  v_application_full uuid := 'd1000000-0000-4000-8000-0000000000e3';
  v_application_ser uuid := 'd1000000-0000-4000-8000-0000000000e4';
  v_application_rev uuid := 'd1000000-0000-4000-8000-0000000000e5';
  v_attempt_rsv uuid := 'd2000000-0000-4000-8000-0000000000e1';
  v_attempt_seq uuid := 'd2000000-0000-4000-8000-0000000000e2';
  v_attempt_full uuid := 'd2000000-0000-4000-8000-0000000000e3';
  v_attempt_ser uuid := 'd2000000-0000-4000-8000-0000000000e4';
  v_attempt_rev uuid := 'd2000000-0000-4000-8000-0000000000e5';
  v_refund_part uuid := 'd3000000-0000-4000-8000-0000000000e1';
  v_refund_remainder uuid := 'd3000000-0000-4000-8000-0000000000e2';
  v_refund_fullonly uuid := 'd3000000-0000-4000-8000-0000000000e3';
  v_refund_serpart uuid := 'd3000000-0000-4000-8000-0000000000e4';
  v_refund_serfull uuid := 'd3000000-0000-4000-8000-0000000000e5';
  v_refund_unreconciled uuid := 'd3000000-0000-4000-8000-0000000000e6';
  v_refund_revfull uuid := 'd3000000-0000-4000-8000-0000000000e7';
  v_discount uuid := 'f0000000-0000-4000-8000-0000000000e1';
  v_wallet uuid := 'f1000000-0000-4000-8000-0000000000e1';
  v_product_rsv uuid := 'b0000000-0000-4000-8000-0000000000e1';
  v_product_seq uuid := 'b0000000-0000-4000-8000-0000000000e2';
  v_product_full uuid := 'b0000000-0000-4000-8000-0000000000e3';
  v_product_ser uuid := 'b0000000-0000-4000-8000-0000000000e4';
  v_product_rev uuid := 'b0000000-0000-4000-8000-0000000000e5';
  v_variant_ser uuid := 'c0000000-0000-4000-8000-0000000000e4';
  v_item_rsv uuid := '20000000-0000-4000-8000-0000000000e1';
  v_item_seq uuid := '20000000-0000-4000-8000-0000000000e2';
  v_item_full uuid := '20000000-0000-4000-8000-0000000000e3';
  v_item_ser uuid := '20000000-0000-4000-8000-0000000000e4';
  v_item_rev uuid := '20000000-0000-4000-8000-0000000000e5';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_claimed boolean;
  v_state text;
  v_stock integer;
  v_qty integer;
  v_locks_before integer;
  v_locks_after integer;
  v_receipt jsonb;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p30@example.com', 'Redvault P30')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R30P1', 'fixed_amount', 100);
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
  INSERT INTO public.products (id, merchant_id, name, price, has_variants, inventory_tracking_policy,
    manage_stock, stock_quantity)
  VALUES
    (v_product_rsv, v_merchant, 'Redvault P30 rsv', 75000, false, 'simple', true, 10),
    (v_product_seq, v_merchant, 'Redvault P30 seq', 75000, false, 'simple', true, 10),
    (v_product_full, v_merchant, 'Redvault P30 full', 75000, false, 'simple', true, 10),
    (v_product_ser, v_merchant, 'Redvault P30 ser', 75000, true, 'serialized_strict', true, 5),
    (v_product_rev, v_merchant, 'Redvault P30 rev', 75000, false, 'simple', true, 10);
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy, attributes,
    stock_quantity)
  VALUES (v_variant_ser, v_product_ser, v_merchant, 'inherit', '{"color":"red"}'::jsonb, 5);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer, v_merchant, NULL, 'redvault-p30@example.com');

  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, total, payment_method, payment_status, shipping_status,
     tracking_token, created_at)
  VALUES
    (v_order_cancel_pay, v_merchant, v_customer, 'R30P1-CANCELPAY', 1500.00, 'uba_redvault', 'cancelled', 'cancelled',
     'track-r30-cancelpay', pg_catalog.now() - interval '10 minutes'),
    (v_order_cancel_ship, v_merchant, v_customer, 'R30P1-CANCELSHIP', 1500.00, 'uba_redvault', 'paid', 'cancelled',
     'track-r30-cancelship', pg_catalog.now() - interval '10 minutes'),
    (v_order_canceled_us, v_merchant, v_customer, 'R30P1-CANCELEDUS', 1500.00, 'uba_redvault', 'paid', 'canceled',
     'track-r30-canceledus', pg_catalog.now() - interval '10 minutes'),
    (v_order_refunded, v_merchant, v_customer, 'R30P1-REFUNDED', 1500.00, 'uba_redvault', 'refunded', 'pending',
     'track-r30-refunded', pg_catalog.now() - interval '10 minutes'),
    (v_order_ok, v_merchant, v_customer, 'R30P1-OK', 1500.00, 'uba_redvault', 'paid', 'pending',
     'track-r30-ok', pg_catalog.now() - interval '10 minutes'),
    (v_order_rsv, v_merchant, v_customer, 'R30P1-RSV', 1500.00, 'uba_redvault', 'paid', 'pending',
     'track-r30-rsv', pg_catalog.now() - interval '10 minutes'),
    (v_order_seq, v_merchant, v_customer, 'R30P1-SEQ', 3000.00, 'uba_redvault', 'paid', 'pending',
     'track-r30-seq', pg_catalog.now() - interval '10 minutes'),
    (v_order_full, v_merchant, v_customer, 'R30P1-FULL', 1500.00, 'uba_redvault', 'paid', 'pending',
     'track-r30-full', pg_catalog.now() - interval '10 minutes'),
    (v_order_ser, v_merchant, v_customer, 'R30P1-SER', 1500.00, 'uba_redvault', 'paid', 'pending',
     'track-r30-ser', pg_catalog.now() - interval '10 minutes'),
    (v_order_rev, v_merchant, v_customer, 'R30P1-REV', 1500.00, 'uba_redvault', 'paid', 'pending',
     'track-r30-rev', pg_catalog.now() - interval '10 minutes');
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES
    (v_item_rsv, v_order_rsv, v_product_rsv, NULL, 'Redvault P30 rsv item', 75000, 2),
    (v_item_seq, v_order_seq, v_product_seq, NULL, 'Redvault P30 seq item', 75000, 4),
    (v_item_full, v_order_full, v_product_full, NULL, 'Redvault P30 full item', 75000, 2),
    (v_item_ser, v_order_ser, v_product_ser, v_variant_ser, 'Redvault P30 ser item', 75000, 2),
    (v_item_rev, v_order_rev, v_product_rev, NULL, 'Redvault P30 rev item', 75000, 2);
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status, user_id)
  VALUES
    (v_application_rsv, v_order_rsv, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p30@example.com', 'R30P1-RSV', 'R30P1-RSV', 100, 150000, 'pending', NULL),
    (v_application_seq, v_order_seq, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p30@example.com', 'R30P1-SEQ', 'R30P1-SEQ', 100, 300000, 'pending', NULL),
    (v_application_full, v_order_full, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p30@example.com', 'R30P1-FULL', 'R30P1-FULL', 100, 150000, 'pending', NULL),
    (v_application_ser, v_order_ser, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p30@example.com', 'R30P1-SER', 'R30P1-SER', 100, 150000, 'pending', NULL),
    (v_application_rev, v_order_rev, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p30@example.com', 'R30P1-REV', 'R30P1-REV', 100, 150000, 'pending', NULL);
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash,
     paystack_subaccount_code, platform_fee_kobo, authorization_url, provider_response)
  VALUES
    (v_attempt_rsv, v_application_rsv, v_order_rsv, v_merchant, 'R30P1-ATTEMPT-RSV', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r30p1', 0, NULL,
     '{"capture_reference":"R30P1-ATTEMPT-RSV","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb),
    (v_attempt_seq, v_application_seq, v_order_seq, v_merchant, 'R30P1-ATTEMPT-SEQ', v_hash,
     300000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r30p1', 0, NULL,
     '{"capture_reference":"R30P1-ATTEMPT-SEQ","capture_amount_kobo":"300000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb),
    (v_attempt_full, v_application_full, v_order_full, v_merchant, 'R30P1-ATTEMPT-FULL', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r30p1', 0, NULL,
     '{"capture_reference":"R30P1-ATTEMPT-FULL","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb),
    (v_attempt_ser, v_application_ser, v_order_ser, v_merchant, 'R30P1-ATTEMPT-SER', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r30p1', 0, NULL,
     '{"capture_reference":"R30P1-ATTEMPT-SER","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb),
    (v_attempt_rev, v_application_rev, v_order_rev, v_merchant, 'R30P1-ATTEMPT-REV', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r30p1', 0, NULL,
     '{"capture_reference":"R30P1-ATTEMPT-REV","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb);
  INSERT INTO private.uba_redvault_line_allocations
    (application_id, order_item_id, line_id, unit_ordinal, allocation_kobo,
     product_id, variant_id, unit_price_kobo, vat_rate_bp, tax_basis)
  VALUES
    (v_application_rsv, v_item_rsv, 1, 1, 0, v_product_rsv, NULL, 75000, 0, 'exclusive'),
    (v_application_rsv, v_item_rsv, 1, 2, 0, v_product_rsv, NULL, 75000, 0, 'exclusive'),
    (v_application_seq, v_item_seq, 1, 1, 0, v_product_seq, NULL, 75000, 0, 'exclusive'),
    (v_application_seq, v_item_seq, 1, 2, 0, v_product_seq, NULL, 75000, 0, 'exclusive'),
    (v_application_seq, v_item_seq, 1, 3, 0, v_product_seq, NULL, 75000, 0, 'exclusive'),
    (v_application_seq, v_item_seq, 1, 4, 0, v_product_seq, NULL, 75000, 0, 'exclusive'),
    (v_application_ser, v_item_ser, 1, 1, 0, v_product_ser, v_variant_ser, 75000, 0, 'exclusive'),
    (v_application_ser, v_item_ser, 1, 2, 0, v_product_ser, v_variant_ser, 75000, 0, 'exclusive'),
    (v_application_rev, v_item_rev, 1, 1, 0, v_product_rev, NULL, 75000, 0, 'exclusive'),
    (v_application_rev, v_item_rev, 1, 2, 0, v_product_rev, NULL, 75000, 0, 'exclusive');
  INSERT INTO private.uba_redvault_refunds (id, attempt_id, idempotency_key, amount_kobo, state, refund_type)
  VALUES
    (v_refund_part, v_attempt_seq, 'R30P1-PART', 75000, 'processed', 'merchandise_units'),
    (v_refund_remainder, v_attempt_seq, 'R30P1-REMAINDER', 225000, 'processed', 'full_capture'),
    (v_refund_fullonly, v_attempt_full, 'R30P1-FULLONLY', 150000, 'processed', 'full_capture'),
    (v_refund_serpart, v_attempt_ser, 'R30P1-SERPART', 150000, 'processed', 'merchandise_units'),
    (v_refund_serfull, v_attempt_ser, 'R30P1-SERFULL', 0, 'processed', 'full_capture'),
    (v_refund_unreconciled, v_attempt_rev, 'R30P1-UNRECONCILED', 75000, 'processed', 'merchandise_units'),
    (v_refund_revfull, v_attempt_rev, 'R30P1-REVFULL', 75000, 'processed', 'full_capture');
  INSERT INTO private.uba_redvault_refund_line_allocations
    (refund_id, application_id, order_item_id, unit_ordinal, net_amount_kobo)
  VALUES
    (v_refund_part, v_application_seq, v_item_seq, 1, 75000),
    (v_refund_serpart, v_application_ser, v_item_ser, 1, 75000),
    (v_refund_serpart, v_application_ser, v_item_ser, 2, 75000),
    (v_refund_unreconciled, v_application_rev, v_item_rev, 1, 75000);
  INSERT INTO private.uba_redvault_refund_lifecycle
    (refund_id, order_id, financial_state, inventory_state, review_reason, inventory_receipt)
  VALUES
    (v_refund_part, v_order_seq, 'refunded', 'released', NULL, '{}'::jsonb),
    (v_refund_remainder, v_order_seq, 'refunded', 'review_required', 'inventory_release_requires_review', NULL),
    (v_refund_fullonly, v_order_full, 'refunded', 'review_required', 'inventory_release_requires_review', NULL),
    (v_refund_serpart, v_order_ser, 'refunded', 'released', NULL, '{}'::jsonb),
    (v_refund_serfull, v_order_ser, 'refunded', 'review_required', 'inventory_release_requires_review', NULL),
    (v_refund_unreconciled, v_order_rev, 'refunded', 'review_required', 'inventory_release_requires_review', NULL),
    (v_refund_revfull, v_order_rev, 'refunded', 'review_required', 'inventory_release_requires_review', NULL);
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- P1 (cancelled claims): every cancelled representation rejects, in both
  -- the claim and the pre-submit payment assertion. Refunded keeps its own
  -- error and a live order still claims.
  BEGIN
    PERFORM public.claim_order_shipment_booking(v_order_cancel_pay, v_merchant, gen_random_uuid());
    RAISE EXCEPTION 'claim on a cancelled-payment order unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_cancelled_for_shipment' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.claim_order_shipment_booking(v_order_cancel_ship, v_merchant, gen_random_uuid());
    RAISE EXCEPTION 'claim on a cancelled-shipping order unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_cancelled_for_shipment' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.claim_order_shipment_booking(v_order_canceled_us, v_merchant, gen_random_uuid());
    RAISE EXCEPTION 'claim on a canceled-spelling order unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_cancelled_for_shipment' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.claim_order_shipment_booking(v_order_refunded, v_merchant, gen_random_uuid());
    RAISE EXCEPTION 'claim on a refunded order unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_refunded_for_shipment' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.assert_shippable_order_payment(v_order_cancel_pay, v_merchant);
    RAISE EXCEPTION 'payment assertion on a cancelled order unexpectedly passed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_cancelled_for_shipment' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.assert_shippable_order_payment(v_order_cancel_ship, v_merchant);
    RAISE EXCEPTION 'payment assertion on a cancelled-shipping order unexpectedly passed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_cancelled_for_shipment' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.assert_shippable_order_payment(v_order_refunded, v_merchant);
    RAISE EXCEPTION 'payment assertion on a refunded order unexpectedly passed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'order_refunded_for_shipment' THEN RAISE; END IF;
  END;
  PERFORM public.assert_shippable_order_payment(v_order_ok, v_merchant);
  SELECT claimed INTO v_claimed
  FROM public.claim_order_shipment_booking(v_order_ok, v_merchant, gen_random_uuid());
  IF v_claimed IS NOT TRUE THEN RAISE EXCEPTION 'claim on a live order failed'; END IF;

  -- P1 (reservation lock protocol): reserving takes the order advisory
  -- lock held till transaction end, and the reservation still succeeds.
  SELECT count(*) INTO v_locks_before FROM pg_locks
  WHERE locktype = 'advisory' AND pid = pg_backend_pid();
  SELECT state INTO v_state FROM public.reserve_uba_redvault_refund(v_attempt_rsv, v_merchant,
    'R30P1-RSV', 'merchandise_units',
    jsonb_build_array(jsonb_build_object('orderItemId', v_item_rsv::text, 'unitOrdinal', 1)));
  IF v_state <> 'pending' THEN
    RAISE EXCEPTION 'reservation did not succeed, got %', v_state;
  END IF;
  SELECT count(*) INTO v_locks_after FROM pg_locks
  WHERE locktype = 'advisory' AND pid = pg_backend_pid();
  IF v_locks_after <= v_locks_before THEN
    RAISE EXCEPTION 'reservation did not acquire the order advisory lock';
  END IF;

  -- P1 (remainder restock): run the partial release for real (stock 10 -> 11,
  -- surviving 3 of 4), then resolve the remainder: only the 3 unrestored
  -- units restock, for 14 — not 15.
  PERFORM private.release_redvault_refund_quantity_units(v_refund_part);
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_seq;
  IF v_stock <> 11 THEN RAISE EXCEPTION 'partial release restocked %, want 11', v_stock; END IF;
  SELECT (fulfillment_data->>'fulfillmentQuantity')::integer INTO v_qty
  FROM public.order_items WHERE id = v_item_seq;
  IF v_qty <> 3 THEN RAISE EXCEPTION 'partial release surviving %, want 3', v_qty; END IF;
  SELECT public.resolve_uba_redvault_refund_inventory_review(v_refund_remainder) INTO v_receipt;
  IF (v_receipt->>'releasePath') <> 'full_order' THEN
    RAISE EXCEPTION 'remainder resolved via %, want full_order', v_receipt->>'releasePath';
  END IF;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_seq;
  IF v_stock <> 14 THEN RAISE EXCEPTION 'remainder restocked to %, want 14', v_stock; END IF;
  SELECT inventory_state INTO v_state FROM private.uba_redvault_refund_lifecycle
  WHERE refund_id = v_refund_remainder;
  IF v_state <> 'released' THEN RAISE EXCEPTION 'remainder lifecycle %, want released', v_state; END IF;

  -- A full capture with no prior partials still restocks the whole line.
  SELECT public.resolve_uba_redvault_refund_inventory_review(v_refund_fullonly) INTO v_receipt;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_full;
  IF v_stock <> 12 THEN RAISE EXCEPTION 'full-only restocked to %, want 12', v_stock; END IF;

  -- Serialized lines restock in full even with released partial links: the
  -- partial quantity path never touches them.
  SELECT public.resolve_uba_redvault_refund_inventory_review(v_refund_serfull) INTO v_receipt;
  SELECT stock_quantity INTO v_stock FROM public.product_variants WHERE id = v_variant_ser;
  IF v_stock <> 7 THEN RAISE EXCEPTION 'serialized remainder restocked to %, want 7', v_stock; END IF;

  -- A processed partial stuck in review never restored stock, so the
  -- remainder still restocks the whole line.
  SELECT public.resolve_uba_redvault_refund_inventory_review(v_refund_revfull) INTO v_receipt;
  SELECT stock_quantity INTO v_stock FROM public.products WHERE id = v_product_rev;
  IF v_stock <> 12 THEN RAISE EXCEPTION 'review-partial remainder restocked to %, want 12', v_stock; END IF;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
