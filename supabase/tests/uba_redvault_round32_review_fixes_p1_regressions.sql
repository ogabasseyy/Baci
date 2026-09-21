-- Round-32 P2 regressions: the v2 reservation wrapper (the production
-- entry point) delegates all locking to v1, so the advisory-first
-- order holds end to end. Behavior is otherwise unchanged:
-- idempotent keys replay, needs_reconciliation short-circuits, and
-- unknown/mismatched attempts reject.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db77';
  v_customer uuid := '22222222-0000-4000-8000-0000000000a1';
  v_order_rsv uuid := '10000000-0000-4000-8000-0000000000a1';
  v_order_rec uuid := '10000000-0000-4000-8000-0000000000a2';
  v_application_rsv uuid := 'd1000000-0000-4000-8000-0000000000a1';
  v_application_rec uuid := 'd1000000-0000-4000-8000-0000000000a2';
  v_attempt_rsv uuid := 'd2000000-0000-4000-8000-0000000000a1';
  v_attempt_rec uuid := 'd2000000-0000-4000-8000-0000000000a2';
  v_refund_rec uuid := 'd3000000-0000-4000-8000-0000000000a1';
  v_discount uuid := 'f0000000-0000-4000-8000-0000000000a1';
  v_wallet uuid := 'f1000000-0000-4000-8000-0000000000a1';
  v_product_rsv uuid := 'b0000000-0000-4000-8000-0000000000a1';
  v_product_rec uuid := 'b0000000-0000-4000-8000-0000000000a2';
  v_item_rsv uuid := '20000000-0000-4000-8000-0000000000a1';
  v_item_rec uuid := '20000000-0000-4000-8000-0000000000a2';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_state text;
  v_first uuid;
  v_second uuid;
  v_locks_before integer;
  v_locks_after integer;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p32@example.com', 'Redvault P32')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R32P2', 'fixed_amount', 100);
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
    (v_product_rsv, v_merchant, 'Redvault P32 rsv', 75000, false, 'simple', true, 10),
    (v_product_rec, v_merchant, 'Redvault P32 rec', 75000, false, 'simple', true, 10);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer, v_merchant, NULL, 'redvault-p32@example.com');

  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, total, payment_method, payment_status, shipping_status,
     tracking_token, created_at)
  VALUES
    (v_order_rsv, v_merchant, v_customer, 'R32P2-RSV', 1500.00, 'uba_redvault', 'paid', 'pending',
     'track-r32-rsv', pg_catalog.now() - interval '10 minutes'),
    (v_order_rec, v_merchant, v_customer, 'R32P2-REC', 1500.00, 'uba_redvault', 'paid', 'pending',
     'track-r32-rec', pg_catalog.now() - interval '10 minutes');
  INSERT INTO public.order_items (id, order_id, product_id, variant_id, name, price, quantity)
  VALUES
    (v_item_rsv, v_order_rsv, v_product_rsv, NULL, 'Redvault P32 rsv item', 75000, 2),
    (v_item_rec, v_order_rec, v_product_rec, NULL, 'Redvault P32 rec item', 75000, 2);
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status, user_id)
  VALUES
    (v_application_rsv, v_order_rsv, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p32@example.com', 'R32P2-RSV', 'R32P2-RSV', 100, 150000, 'pending', NULL),
    (v_application_rec, v_order_rec, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p32@example.com', 'R32P2-REC', 'R32P2-REC', 100, 150000, 'pending', NULL);
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash,
     paystack_subaccount_code, platform_fee_kobo, authorization_url, provider_response)
  VALUES
    (v_attempt_rsv, v_application_rsv, v_order_rsv, v_merchant, 'R32P2-ATTEMPT-RSV', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r32p2', 0, NULL,
     '{"capture_reference":"R32P2-ATTEMPT-RSV","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb),
    (v_attempt_rec, v_application_rec, v_order_rec, v_merchant, 'R32P2-ATTEMPT-REC', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r32p2', 0, NULL,
     '{"capture_reference":"R32P2-ATTEMPT-REC","capture_amount_kobo":"150000","capture_currency":"NGN","capture_status":"success","held_reason":"provider_eligibility_evidence_unavailable"}'::jsonb);
  INSERT INTO private.uba_redvault_line_allocations
    (application_id, order_item_id, line_id, unit_ordinal, allocation_kobo,
     product_id, variant_id, unit_price_kobo, vat_rate_bp, tax_basis)
  VALUES
    (v_application_rsv, v_item_rsv, 1, 1, 0, v_product_rsv, NULL, 75000, 0, 'exclusive'),
    (v_application_rsv, v_item_rsv, 1, 2, 0, v_product_rsv, NULL, 75000, 0, 'exclusive'),
    (v_application_rec, v_item_rec, 1, 1, 0, v_product_rec, NULL, 75000, 0, 'exclusive'),
    (v_application_rec, v_item_rec, 1, 2, 0, v_product_rec, NULL, 75000, 0, 'exclusive');
  INSERT INTO private.uba_redvault_refunds (id, attempt_id, idempotency_key, amount_kobo, state, refund_type)
  VALUES (v_refund_rec, v_attempt_rec, 'R32P2-REC-ORIG', 75000, 'needs_reconciliation', 'merchandise_units');
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- The production path reserves through v2, takes the order advisory
  -- lock, and replays idempotent keys.
  SELECT count(*) INTO v_locks_before FROM pg_locks
  WHERE locktype = 'advisory' AND pid = pg_backend_pid();
  SELECT id, state INTO v_first, v_state FROM public.reserve_uba_redvault_refund_v2(v_attempt_rsv,
    v_merchant, 'R32P2-RSV', 'merchandise_units',
    jsonb_build_array(jsonb_build_object('orderItemId', v_item_rsv::text, 'unitOrdinal', 1)));
  IF v_state <> 'pending' THEN
    RAISE EXCEPTION 'v2 reservation did not succeed, got %', v_state;
  END IF;
  SELECT count(*) INTO v_locks_after FROM pg_locks
  WHERE locktype = 'advisory' AND pid = pg_backend_pid();
  IF v_locks_after <= v_locks_before THEN
    RAISE EXCEPTION 'v2 reservation did not acquire the order advisory lock';
  END IF;
  SELECT id INTO v_second FROM public.reserve_uba_redvault_refund_v2(v_attempt_rsv,
    v_merchant, 'R32P2-RSV', 'merchandise_units',
    jsonb_build_array(jsonb_build_object('orderItemId', v_item_rsv::text, 'unitOrdinal', 1)));
  IF v_second IS DISTINCT FROM v_first THEN
    RAISE EXCEPTION 'v2 idempotent replay returned a different refund';
  END IF;

  -- A needs_reconciliation sibling still short-circuits new reserves.
  BEGIN
    PERFORM public.reserve_uba_redvault_refund_v2(v_attempt_rec, v_merchant,
      'R32P2-REC-NEW', 'merchandise_units',
      jsonb_build_array(jsonb_build_object('orderItemId', v_item_rec::text, 'unitOrdinal', 1)));
    RAISE EXCEPTION 'v2 reservation alongside needs_reconciliation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_refund_amount_reserved' THEN RAISE; END IF;
  END;

  -- Unknown attempts and merchant mismatches still reject.
  BEGIN
    PERFORM public.reserve_uba_redvault_refund_v2(gen_random_uuid(), v_merchant,
      'R32P2-MISSING', 'full_capture');
    RAISE EXCEPTION 'v2 reservation on a missing attempt unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> 'P0002' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.reserve_uba_redvault_refund_v2(v_attempt_rsv, gen_random_uuid(),
      'R32P2-MISMATCH', 'full_capture');
    RAISE EXCEPTION 'v2 reservation on a mismatched merchant unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_refund_attempt_not_found' THEN RAISE; END IF;
  END;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
