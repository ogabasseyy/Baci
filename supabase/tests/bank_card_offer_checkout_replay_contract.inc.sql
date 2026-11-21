DO $$
DECLARE
  v_merchant uuid := 'a4387000-0000-4000-8000-000000000011';
  v_customer uuid := 'a4387000-0000-4000-8000-000000000012';
  v_user uuid := 'a4387000-0000-4000-8000-000000000013';
  v_product uuid := 'a4387000-0000-4000-8000-000000000014';
  v_order uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_quote jsonb;
  v_hash text := repeat('a', 64);
  v_checkout_key text;
  v_checkout_order jsonb;
  v_checkout_quote jsonb;
  v_proof jsonb;
  v_proof_payload jsonb;
  v_proof_hash text;
  v_issued_at text := now()::text;
  v_action text := 'storefront_bank_card_offer_order_create';
  v_test_secret text := 'synthetic-checkout-replay-proof-secret';
  v_checkout_replay jsonb;
BEGIN
  IF has_table_privilege('authenticated', 'private.bank_card_offer_payment_attempts', 'SELECT')
    OR has_function_privilege('anon', 'public.claim_bank_card_offer_attempt(uuid,uuid,bigint,text,text,bigint,bigint)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.bank_card_offer_refund_capture_matches(uuid,uuid,uuid,text,bigint)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.request_bank_card_offer_initialization_review(uuid,uuid,text,boolean)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.ensure_bank_card_offer_capture_sweep(text)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.ensure_bank_card_offer_capture_sweep(text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.get_bank_card_offer_refundable_amount(uuid,uuid,uuid,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.get_bank_card_offer_refundable_amount(uuid,uuid,uuid,text)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.get_bank_card_offer_refundable_amount(uuid,uuid,uuid,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.flag_bank_card_offer_capture_review(uuid,uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.flag_bank_card_offer_capture_review(uuid,uuid,uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.flag_bank_card_offer_capture_review(uuid,uuid,uuid)', 'EXECUTE')
  THEN RAISE EXCEPTION 'bank offer attempt privileges are incorrect'; END IF;

  INSERT INTO auth.users (id, email) VALUES (v_user, 'bank-attempt-buyer@example.test');
  -- Merchant creation is audited in the full replay schema.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  INSERT INTO public.merchants (id, email, business_name, slug, paystack_subaccount_code)
    VALUES (v_merchant, 'bank-attempt-store@example.test', 'Bank Attempt Store', 'bank-attempt-store', 'ACCT_synthetic');
  PERFORM set_config('request.jwt.claim.role', '', true);
  INSERT INTO public.customers (id, merchant_id, user_id, email)
    VALUES (v_customer, v_merchant, v_user, 'bank-attempt-buyer@example.test');
  INSERT INTO public.products (id, merchant_id, name, slug, price, status)
    VALUES (v_product, v_merchant, 'Fixture Phone', 'bank-attempt-phone', 100, 'active');
  INSERT INTO public.orders (id, merchant_id, customer_id, order_number, currency, payment_method,
    payment_status, shipping_status, customer_email, total, discount_amount, tax_basis,
    checkout_idempotency_key, checkout_request_hash)
    VALUES (v_order, v_merchant, v_customer, 'BANK-OFFER-ATTEMPT', 'NGN', 'bank_card_offer',
      'unpaid', 'pending', 'bank-attempt-buyer@example.test', 95, 5, 'exclusive', 'bank-test-key', v_hash);
  INSERT INTO public.order_items (id, order_id, product_id, name, price, quantity)
    VALUES (v_item, v_order, v_product, 'Fixture Phone', 100, 1);
  v_quote := jsonb_build_object('merchantId', v_merchant, 'discountKobo', 500,
    'endsAt', '2100-01-01T00:00:00Z',
    'paymentPolicy', jsonb_build_object('bankCode', '035', 'issuerName', 'Wema Bank', 'cardBrands', jsonb_build_array('visa')),
    'allocations', jsonb_build_array(jsonb_build_object(
      'itemId', v_item, 'productId', v_product, 'unitPriceKobo', 10000, 'quantity', 1,
      'unitNetAmountsKobo', jsonb_build_array(9500))));
  PERFORM private.record_bank_card_offer_order(v_order, v_merchant, v_quote);

  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', v_user)::text, true);
  IF public.get_bank_card_offer_checkout_context(v_order, v_merchant) IS NOT NULL THEN
    RAISE EXCEPTION 'Unscoped customer could read checkout context';
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', v_user,
    'storefront_order_context', 'route', 'storefront_order_merchant_id', v_merchant)::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', gen_random_uuid(),
    'storefront_order_context', 'route', 'storefront_order_merchant_id', v_merchant)::text, true);
  IF public.get_bank_card_offer_checkout_context(v_order, v_merchant) IS NOT NULL THEN
    RAISE EXCEPTION 'A different signed customer should not read the attempt context';
  END IF;
  BEGIN
    PERFORM public.claim_bank_card_offer_attempt(v_order, v_merchant, 9500, v_hash, 'test', 100, 0);
    RAISE EXCEPTION 'A different signed customer could claim the attempt';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bank_card_offer_attempt_unavailable' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', v_user,
    'storefront_order_context', 'route', 'storefront_order_merchant_id', v_merchant)::text, true);
  IF public.get_bank_card_offer_checkout_replay(v_merchant, 'bank-test-key', v_hash)->>'id' IS DISTINCT FROM v_order::text THEN
    RAISE EXCEPTION 'Checkout replay should return the saved order';
  END IF;
  PERFORM set_config('app.quiz_rpc_server_secret_current', v_test_secret, true);
  UPDATE public.orders SET payment_status = 'pending' WHERE id = v_order;
  FOREACH v_checkout_key IN ARRAY ARRAY['bank-expired-test-key', 'bank-test-key']
  LOOP
    v_checkout_order := jsonb_build_object('merchant_id', v_merchant, 'user_id', v_user,
      'checkout_idempotency_key', v_checkout_key, 'checkout_request_hash', v_hash);
    v_checkout_quote := jsonb_set(v_quote, '{endsAt}', to_jsonb(
      CASE WHEN v_checkout_key = 'bank-test-key' THEN now() + interval '1 hour'
        ELSE now() - interval '1 second' END
    ));
    v_proof_payload := jsonb_build_object('order', v_checkout_order, 'quote', v_checkout_quote);
    v_proof_hash := private.transaction_discount_payload_hash(v_proof_payload);
    v_proof := jsonb_build_object('action', v_action, 'subject_id', v_merchant,
      'user_id', v_user, 'scope', 'quiz_phase1a', 'version', 'quiz-rpc-proof:v1',
      'issued_at', v_issued_at, 'proof_id', gen_random_uuid(), 'payload_hash', v_proof_hash,
      'payload', v_proof_payload, 'signature', encode(extensions.hmac(
        concat_ws(E'\n', 'quiz-rpc-proof:v1', 'quiz_phase1a', v_action,
          v_merchant::text, v_user::text, v_issued_at, v_proof_hash), v_test_secret, 'sha256'
      ), 'hex'));
    IF v_checkout_key = 'bank-test-key' THEN
      v_checkout_replay := public.create_storefront_bank_card_offer_order(
        v_checkout_order, v_checkout_quote, v_proof
      );
      IF v_checkout_replay->>'id' IS DISTINCT FROM v_order::text
        OR v_checkout_replay->>'idempotency_replayed' IS DISTINCT FROM 'true'
        OR v_checkout_replay->>'payment_status' IS DISTINCT FROM 'pending'
        OR (SELECT payment_status FROM public.orders WHERE id = v_order) <> 'pending'
        OR v_checkout_replay->>'created_at' IS NULL
        OR (v_checkout_replay->>'created_at')::timestamptz IS DISTINCT FROM (
          SELECT created_at FROM public.orders WHERE id = v_order
        )
      THEN RAISE EXCEPTION 'Atomic retry must return the original order and timestamp'; END IF;
    ELSE
      BEGIN
        PERFORM public.create_storefront_bank_card_offer_order(v_checkout_order, v_checkout_quote, v_proof);
        RAISE EXCEPTION 'Expired bank offer created an order';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'bank_card_offer_checkout_expired' THEN RAISE; END IF;
      END;
    END IF;
  END LOOP;
  BEGIN
    PERFORM public.get_bank_card_offer_checkout_replay(v_merchant, 'bank-test-key', repeat('b', 64));
    RAISE EXCEPTION 'A different bank checkout body replayed the old order';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'checkout_idempotency_conflict' THEN RAISE; END IF;
  END;
  BEGIN
    -- Give the replay guard an inconsistent saved fixture. The expected
    -- exception rolls back the fixture update before the payment checks.
    UPDATE private.bank_card_offer_order_snapshots
      SET payable_kobo = 9600 WHERE order_id = v_order;
    PERFORM public.get_bank_card_offer_checkout_replay(v_merchant, 'bank-test-key', v_hash);
    RAISE EXCEPTION 'An inconsistent bank offer total was replayed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bank_card_offer_checkout_mismatch' THEN RAISE; END IF;
  END;

  PERFORM set_config('test.bank_offer_attempt_fixture',
    jsonb_build_object('merchant', v_merchant, 'user', v_user, 'order', v_order, 'hash', v_hash)::text, true);
END;
$$;
