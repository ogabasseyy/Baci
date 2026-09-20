-- Round-13 P1 regressions: live initialized attempts block customer
-- cancellation; refund reconciliation reports the provider-submission
-- timestamp; REDVAULT GIGL orders settle wallet-free with retained
-- shipping; scoped capture preserves validated provider fees.
BEGIN;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant uuid := '6b5cb8a4-5575-456c-b936-8cdfae30db74';
  v_user uuid := '11111111-0000-4000-8000-000000000083';
  v_customer uuid := '22222222-0000-4000-8000-000000000083';
  v_order_init uuid := '10000000-0000-4000-8000-000000000081';
  v_order_created uuid := '10000000-0000-4000-8000-000000000082';
  v_order_refund uuid := '10000000-0000-4000-8000-000000000083';
  v_order_gigl uuid := '10000000-0000-4000-8000-000000000084';
  v_order_plain uuid := '10000000-0000-4000-8000-000000000085';
  v_order_cap uuid := '10000000-0000-4000-8000-000000000086';
  v_order_cap_bad uuid := '10000000-0000-4000-8000-000000000087';
  v_application_init uuid := 'd1000000-0000-4000-8000-000000000081';
  v_application_created uuid := 'd1000000-0000-4000-8000-000000000082';
  v_application_refund uuid := 'd1000000-0000-4000-8000-000000000083';
  v_application_cap uuid := 'd1000000-0000-4000-8000-000000000086';
  v_application_cap_bad uuid := 'd1000000-0000-4000-8000-000000000087';
  v_attempt_init uuid := 'd2000000-0000-4000-8000-000000000081';
  v_attempt_created uuid := 'd2000000-0000-4000-8000-000000000082';
  v_attempt_refund uuid := 'd2000000-0000-4000-8000-000000000083';
  v_attempt_cap uuid := 'd2000000-0000-4000-8000-000000000086';
  v_attempt_cap_bad uuid := 'd2000000-0000-4000-8000-000000000087';
  v_refund uuid := 'e1000000-0000-4000-8000-000000000083';
  v_quote_gigl uuid := 'a2000000-0000-4000-8000-000000000083';
  v_txn_cap uuid := 'd3000000-0000-4000-8000-000000000086';
  v_txn_cap_bad uuid := 'd3000000-0000-4000-8000-000000000087';
  v_discount uuid := 'f0000000-0000-4000-8000-000000000083';
  v_wallet uuid := 'f1000000-0000-4000-8000-000000000083';
  v_product uuid := 'b0000000-0000-4000-8000-000000000083';
  v_variant uuid := 'c0000000-0000-4000-8000-000000000083';
  v_hash text := 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  v_policy jsonb := jsonb_build_object('bankCode', '058', 'issuerName', 'GTBank', 'verificationDomain', 'test',
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'));
  v_state text;
  v_status text;
  v_claimed boolean;
  v_claim_id uuid;
  v_settlement uuid;
  v_net numeric;
  v_fee numeric;
  v_retained numeric;
  v_upcoming numeric;
  v_submitted timestamptz;
  v_created timestamptz;
  v_result jsonb;
BEGIN
  -- Orders writes must ride the protected path like production writers do.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  INSERT INTO public.merchants (id, email, business_name)
  VALUES (v_merchant, 'redvault-p13@example.com', 'Redvault P13')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.merchant_wallets (id, merchant_id)
  VALUES (v_wallet, v_merchant)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.discount_codes (id, merchant_id, code, discount_type, discount_value)
  VALUES (v_discount, v_merchant, 'R13P1', 'fixed_amount', 100);
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
  VALUES (v_product, v_merchant, 'Redvault P13 product', 150000, true, 'serialized_strict');
  INSERT INTO public.product_variants (id, product_id, merchant_id, inventory_tracking_policy, attributes)
  VALUES (v_variant, v_product, v_merchant, 'inherit', '{"color":"red","storage":"128GB"}'::jsonb);
  INSERT INTO auth.users (id) VALUES (v_user);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer, v_merchant, v_user, 'redvault-p13@example.com');

  -- The GIGL economics stamp trigger derives the retained snapshot from
  -- the selected quote; seed one so the fixture keeps its retention.
  INSERT INTO public.shipping_quotes
    (id, session_id, provider, price, expires_at, merchant_id,
     provider_cost, platform_margin, pricing_version)
  VALUES (v_quote_gigl, 'R13P1-SESSION', 'GIGL', 200,
    pg_catalog.now() + interval '1 hour', v_merchant, 150, 50,
    'gigl_platform_margin_v1');
  INSERT INTO public.orders
    (id, merchant_id, customer_id, order_number, total, payment_method, payment_status, shipping_status,
     shipping_funding_source, shipping_provider, shipping_pricing_version, shipping_platform_retained_amount,
     selected_quote_id, created_at)
  VALUES
    (v_order_init, v_merchant, v_customer, 'R13P1-INIT', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     NULL, NULL, NULL, NULL, NULL, pg_catalog.now() - interval '10 minutes'),
    (v_order_created, v_merchant, v_customer, 'R13P1-CREATED', 1500.00, 'uba_redvault', 'unpaid', 'pending',
     NULL, NULL, NULL, NULL, NULL, pg_catalog.now() - interval '10 minutes'),
    (v_order_refund, v_merchant, v_customer, 'R13P1-REFUND', 1500.00, 'uba_redvault', 'paid', 'processing',
     NULL, NULL, NULL, NULL, NULL, pg_catalog.now() - interval '10 minutes'),
    (v_order_gigl, v_merchant, v_customer, 'R13P1-GIGL', 1500.00, 'uba_redvault', 'paid', 'processing',
     'customer_checkout', 'GIGL', 'gigl_platform_margin_v1', 200, v_quote_gigl,
     pg_catalog.now() - interval '10 minutes'),
    (v_order_plain, v_merchant, v_customer, 'R13P1-PLAIN', 1500.00, 'card', 'paid', 'processing',
     NULL, NULL, NULL, NULL, NULL, pg_catalog.now() - interval '10 minutes'),
    (v_order_cap, v_merchant, v_customer, 'R13P1-CAP', 1500.00, 'uba_redvault', 'paid', 'processing',
     NULL, NULL, NULL, NULL, NULL, pg_catalog.now() - interval '10 minutes'),
    (v_order_cap_bad, v_merchant, v_customer, 'R13P1-CAPBAD', 1500.00, 'uba_redvault', 'paid', 'processing',
     NULL, NULL, NULL, NULL, NULL, pg_catalog.now() - interval '10 minutes');
  INSERT INTO private.uba_redvault_applications
    (id, order_id, discount_code_id, merchant_id, quote_version_id, quote_payload_hash,
     quote_payload, customer_email, checkout_key, request_hash,
     discount_kobo, eligible_subtotal_kobo, status, user_id)
  VALUES
    (v_application_init, v_order_init, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p13@example.com', 'R13P1-INIT', 'R13P1-INIT', 100, 150000, 'pending', v_user),
    (v_application_created, v_order_created, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p13@example.com', 'R13P1-CREATED', 'R13P1-CREATED', 100, 150000, 'pending', v_user),
    (v_application_refund, v_order_refund, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p13@example.com', 'R13P1-REFUND', 'R13P1-REFUND', 100, 150000, 'pending', v_user),
    (v_application_cap, v_order_cap, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p13@example.com', 'R13P1-CAP', 'R13P1-CAP', 100, 150000, 'pending', v_user),
    (v_application_cap_bad, v_order_cap_bad, v_discount, v_merchant, gen_random_uuid(), v_hash,
     '{}'::jsonb, 'redvault-p13@example.com', 'R13P1-CAPBAD', 'R13P1-CAPBAD', 100, 150000, 'pending', v_user);
  INSERT INTO private.uba_redvault_payment_attempts
    (id, application_id, order_id, merchant_id, reference, quote_payload_hash,
     amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash,
     paystack_subaccount_code, platform_fee_kobo, authorization_url)
  VALUES
    (v_attempt_init, v_application_init, v_order_init, v_merchant, 'R13P1-ATTEMPT-INIT', v_hash,
     150000, 'NGN', 'initialized', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r13p1', 0,
     'https://checkout.paystack.com/r13p1-init'),
    (v_attempt_created, v_application_created, v_order_created, v_merchant, 'R13P1-ATTEMPT-CREATED', v_hash,
     150000, 'NGN', 'created', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r13p1', 0, NULL),
    (v_attempt_refund, v_application_refund, v_order_refund, v_merchant, 'R13P1-ATTEMPT-REFUND', v_hash,
     150000, 'NGN', 'approved', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r13p1', 0, NULL),
    (v_attempt_cap, v_application_cap, v_order_cap, v_merchant, 'R13P1-CAP', v_hash,
     150000, 'NGN', 'initialized', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r13p1', 0,
     'https://checkout.paystack.com/r13p1-cap'),
    (v_attempt_cap_bad, v_application_cap_bad, v_order_cap_bad, v_merchant, 'R13P1-CAPBAD', v_hash,
     150000, 'NGN', 'initialized', v_policy,
     encode(extensions.digest(v_policy::text, 'sha256'), 'hex'), 'ACCT_r13p1', 0,
     'https://checkout.paystack.com/r13p1-capbad');
  INSERT INTO private.uba_redvault_refunds
    (id, attempt_id, state, refund_type, idempotency_key, amount_kobo)
  VALUES (v_refund, v_attempt_refund, 'pending', 'merchandise_units', 'R13P1-REFUND', 10000);
  INSERT INTO public.transactions
    (id, merchant_id, order_id, transaction_type, amount, currency, status, gateway, gateway_reference, platform_fee)
  VALUES
    (v_txn_cap, v_merchant, v_order_cap, 'payment', 1500.00, 'NGN',
     'pending', 'paystack', 'R13P1-CAP', NULL),
    (v_txn_cap_bad, v_merchant, v_order_cap_bad, 'payment', 1500.00, 'NGN',
     'pending', 'paystack', 'R13P1-CAPBAD', NULL);
  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();

  -- P1 (initialized cancellation): a live hosted URL blocks customer
  -- cancellation; a never-initialized attempt still cancels.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  BEGIN
    PERFORM public.cancel_uba_redvault_order_as_customer(v_order_init, 'nope');
    RAISE EXCEPTION 'customer cancel of initialized unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_customer_cancel_active' THEN RAISE; END IF;
  END;
  SELECT public.cancel_uba_redvault_order_as_customer(v_order_created, 'changed mind')
  INTO v_claimed;
  IF v_claimed IS NOT TRUE THEN
    RAISE EXCEPTION 'customer cancel of created attempt did not succeed';
  END IF;
  SELECT payment_status INTO v_state FROM public.orders WHERE id = v_order_created;
  IF v_state <> 'cancelled' THEN
    RAISE EXCEPTION 'created order was not cancelled, got %', v_state;
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  -- P1 (refund submission timestamp): the submission claim stamps the
  -- pending -> processing transition, and reconciliation reports that
  -- stamp rather than the older reservation time.
  SELECT id INTO v_claim_id FROM public.claim_next_uba_redvault_refund();
  IF v_claim_id <> v_refund THEN
    RAISE EXCEPTION 'pending refund was not claimed, got %', v_claim_id;
  END IF;
  SELECT submitted_to_provider_at INTO v_submitted
  FROM private.uba_redvault_refunds WHERE id = v_refund;
  IF v_submitted IS NULL THEN
    RAISE EXCEPTION 'submission claim did not stamp submitted_to_provider_at';
  END IF;
  -- Age the reservation so created_at and the submission stamp differ.
  UPDATE private.uba_redvault_refunds
  SET created_at = pg_catalog.now() - interval '1 hour',
      provider_reference = 'R13P1-PROVIDER-REF'
  WHERE id = v_refund;
  SELECT submitted_at INTO v_submitted
  FROM public.claim_next_uba_redvault_refund_reconciliation();
  SELECT created_at INTO v_created FROM private.uba_redvault_refunds WHERE id = v_refund;
  IF v_submitted IS NULL OR v_submitted <= v_created THEN
    RAISE EXCEPTION 'reconciliation reported reservation time: submitted %, created %',
      v_submitted, v_created;
  END IF;

  -- P1 (direct-split GIGL settlement): the variant records the GIGL
  -- retention into an informational settled row with no wallet movement,
  -- stays idempotent, and fails closed on non-split orders.
  SELECT public.record_uba_redvault_direct_settlement_gigl_v1(v_merchant, 'order', v_order_gigl, 'paystack',
    'R13P1-GIGL-REF', 1500.00, 100, 50, 'test', '{"commerce_platform_fee":50}'::jsonb)
  INTO v_settlement;
  IF v_settlement IS NULL THEN
    RAISE EXCEPTION 'GIGL direct settlement was not recorded';
  END IF;
  SELECT status, net_amount, platform_fee,
    (metadata ->> 'retained_shipping_amount')::numeric,
    (metadata ->> 'redvault_direct_split')::boolean
  INTO v_status, v_net, v_fee, v_retained, v_claimed
  FROM public.merchant_settlements WHERE id = v_settlement;
  IF v_status <> 'settled' THEN
    RAISE EXCEPTION 'GIGL direct row is payable, got %', v_status;
  END IF;
  IF v_retained <> 200 THEN
    RAISE EXCEPTION 'GIGL direct retention wrong, got %', v_retained;
  END IF;
  IF v_fee <> 250 THEN
    RAISE EXCEPTION 'GIGL direct platform fee wrong, got %', v_fee;
  END IF;
  IF v_net <> 1150.00 THEN
    RAISE EXCEPTION 'GIGL direct net wrong, got %', v_net;
  END IF;
  IF v_claimed IS NOT TRUE THEN
    RAISE EXCEPTION 'GIGL direct row is not flagged as a split sale';
  END IF;
  SELECT upcoming_balance INTO v_upcoming FROM public.merchant_wallets WHERE id = v_wallet;
  IF v_upcoming <> 0 THEN
    RAISE EXCEPTION 'GIGL direct settlement credited the wallet, got %', v_upcoming;
  END IF;
  SELECT public.record_uba_redvault_direct_settlement_gigl_v1(v_merchant, 'order', v_order_gigl, 'paystack',
    'R13P1-GIGL-REF', 1500.00, 100, 50, 'test', '{"commerce_platform_fee":50}'::jsonb)
  INTO v_claim_id;
  IF v_claim_id IS NOT NULL THEN
    RAISE EXCEPTION 'GIGL direct settlement was not idempotent';
  END IF;
  BEGIN
    PERFORM public.record_uba_redvault_direct_settlement_gigl_v1(v_merchant, 'order', v_order_plain, 'paystack',
      'R13P1-OTHER', 1500.00, 100, 50, 'test', '{}'::jsonb);
    RAISE EXCEPTION 'GIGL direct settlement of a non-REDVAULT order unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_direct_settlement_order_mismatch' THEN RAISE; END IF;
  END;

  -- P1 (scoped capture fee persistence): a validated provider fee lands in
  -- the transaction evidence, conflicts raise, and invalid fees raise.
  SELECT public.capture_or_hold_uba_redvault_payment(v_txn_cap, v_order_cap, 'paystack', 'R13P1-CAP',
    '{"reference":"R13P1-CAP","amount":150000,"currency":"NGN","status":"success","fees":1000}'::jsonb)
  INTO v_result;
  IF v_result->>'kind' <> 'captured_held' THEN
    RAISE EXCEPTION 'capture did not hold, got %', v_result;
  END IF;
  SELECT (gateway_response->>'fees')::numeric INTO v_fee
  FROM public.transactions WHERE id = v_txn_cap;
  IF v_fee <> 1000 THEN
    RAISE EXCEPTION 'capture did not persist fees, got %', v_fee;
  END IF;
  BEGIN
    PERFORM public.capture_or_hold_uba_redvault_payment(v_txn_cap, v_order_cap, 'paystack', 'R13P1-CAP',
      '{"reference":"R13P1-CAP","amount":150000,"currency":"NGN","status":"success","fees":2000}'::jsonb);
    RAISE EXCEPTION 'capture fee conflict unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_capture_fee_conflict' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.capture_or_hold_uba_redvault_payment(v_txn_cap_bad, v_order_cap_bad, 'paystack', 'R13P1-CAPBAD',
      '{"reference":"R13P1-CAPBAD","amount":150000,"currency":"NGN","status":"success","fees":999999}'::jsonb);
    RAISE EXCEPTION 'capture with excessive fees unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'redvault_capture_fee_invalid' THEN RAISE; END IF;
  END;

  DELETE FROM private.uba_redvault_write_context
  WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

RESET ROLE;
ROLLBACK;
