BEGIN;

DO $$
DECLARE
  v_merchant uuid := 'a4387000-0000-4000-8000-000000000011';
  v_customer uuid := 'a4387000-0000-4000-8000-000000000012';
  v_user uuid := 'a4387000-0000-4000-8000-000000000013';
  v_product uuid := 'a4387000-0000-4000-8000-000000000014';
  v_order uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_quote jsonb;
  v_attempt jsonb;
  v_transaction uuid;
  v_reference text;
  v_hash text := repeat('a', 64);
  v_evidence jsonb;
  v_gateway_response jsonb;
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
  INSERT INTO public.merchants (id, email, business_name, slug, paystack_subaccount_code)
    VALUES (v_merchant, 'bank-attempt-store@example.test', 'Bank Attempt Store', 'bank-attempt-store', 'ACCT_synthetic');
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
  v_attempt := public.claim_bank_card_offer_attempt(v_order, v_merchant, 9500, v_hash, 'test', 100, 0);
  v_reference := v_attempt->>'reference';
  IF v_attempt->>'claimed' <> 'true' OR v_reference !~ '^BCO-[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'A bank offer must claim a pending Paystack reference';
  END IF;
  SELECT id INTO STRICT v_transaction FROM public.transactions WHERE gateway_reference = v_reference;
  IF public.get_bank_card_offer_verification_context(v_order, v_merchant, v_transaction) IS NOT NULL THEN
    RAISE EXCEPTION 'Customer scope cannot read internal capture context';
  END IF;
  IF public.flag_bank_card_offer_capture_review(v_order, v_merchant, v_transaction) THEN
    RAISE EXCEPTION 'Buyer claims cannot queue a provider capture review directly';
  END IF;
  IF public.request_bank_card_offer_initialization_review(v_order, v_merchant, v_reference, false)
  THEN RAISE EXCEPTION 'An in-flight reference cannot acknowledge an unfiled recovery review'; END IF;
  IF NOT public.ensure_bank_card_offer_capture_sweep(v_reference)
    THEN RAISE EXCEPTION 'A verified owned capture could not request a sweep'; END IF;
  IF NOT public.ensure_bank_card_offer_capture_sweep(v_reference)
    THEN RAISE EXCEPTION 'An existing sweep marker was not acknowledged idempotently'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', gen_random_uuid())::text, true);
  IF public.ensure_bank_card_offer_capture_sweep(v_reference)
    THEN RAISE EXCEPTION 'A different buyer could claim the bank-offer capture marker'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', v_user,
    'storefront_order_context', 'route', 'storefront_order_merchant_id', v_merchant)::text, true);
  IF NOT public.request_bank_card_offer_initialization_review(v_order, v_merchant, v_reference, true)
    THEN RAISE EXCEPTION 'A failed attempt did not acknowledge its durable review'; END IF;
  IF NOT public.request_bank_card_offer_initialization_review(v_order, v_merchant, v_reference, false)
    THEN RAISE EXCEPTION 'A replay did not acknowledge the existing durable review'; END IF;
  DECLARE v_review_id uuid;
  BEGIN
    SELECT id INTO STRICT v_review_id FROM public.reconciliation_review
    WHERE txn_id = v_transaction AND metadata->>'source' = 'bank_card_offer_initialization';
    IF public.retire_bank_card_offer_initialization(v_review_id, '')
      OR NOT public.retire_bank_card_offer_initialization(v_review_id, 'Paystack case fixture confirms the reference cannot charge')
    THEN RAISE EXCEPTION 'A confirmed unusable reference should be retired'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.transactions WHERE id = v_transaction AND status = 'cancelled')
    THEN RAISE EXCEPTION 'A retired reference must retain its audit row'; END IF;
  END;
  v_attempt := public.claim_bank_card_offer_attempt(v_order, v_merchant, 9500, v_hash, 'test', 100, 0);
  IF v_attempt->>'claimed' IS DISTINCT FROM 'true' OR v_attempt->>'reference' = v_reference
  THEN RAISE EXCEPTION 'A retired reference must permit a fresh claim'; END IF;
  v_reference := v_attempt->>'reference';
  SELECT id INTO STRICT v_transaction FROM public.transactions WHERE gateway_reference = v_reference;
  PERFORM public.flag_bank_card_offer_initialization_review(v_order, v_merchant, v_reference, true);
  DECLARE v_review_id uuid;
  BEGIN
    SELECT id INTO STRICT v_review_id FROM public.reconciliation_review
    WHERE txn_id = v_transaction AND metadata->>'source' = 'bank_card_offer_initialization';
    IF public.restore_bank_card_offer_checkout_url(v_review_id, 'https://checkout.paystack.com.evil.test/trx/test')
      OR NOT public.restore_bank_card_offer_checkout_url(v_review_id, 'https://checkout.paystack.com/trx/test?state=one%2Btwo&x=1')
      OR NOT public.record_bank_card_offer_checkout_url(v_order, v_merchant, v_reference, 'https://checkout.paystack.com/trx/test?state=one%2Btwo&x=1')
    THEN RAISE EXCEPTION 'An operator must be able to restore the same checked URL idempotently'; END IF;
  END;
  v_attempt := public.claim_bank_card_offer_attempt(v_order, v_merchant, 9500, v_hash, 'test', 100, 0);
  IF v_attempt->>'claimed' <> 'false' OR v_attempt->>'reference' <> v_reference
    OR v_attempt->>'checkoutUrl' <> 'https://checkout.paystack.com/trx/test?state=one%2Btwo&x=1'
  THEN RAISE EXCEPTION 'A retry must replay its existing Paystack reference'; END IF;
  IF public.flag_bank_card_offer_terminal_review(v_order, v_merchant, v_transaction, 'abandoned')
    THEN RAISE EXCEPTION 'Shopper scope recorded a terminal provider status'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated',
    'storefront_order_context', 'route', 'storefront_order_merchant_id', v_merchant)::text, true);
  IF public.flag_bank_card_offer_capture_review(v_order, gen_random_uuid(), v_transaction)
    OR public.flag_bank_card_offer_capture_review(v_order, v_merchant, gen_random_uuid())
  THEN RAISE EXCEPTION 'Mismatched context cannot queue a capture review'; END IF;
  BEGIN
    IF NOT public.flag_bank_card_offer_capture_review(v_order, v_merchant, v_transaction)
      THEN RAISE EXCEPTION 'Scoped capture mismatch was not queued'; END IF;
    IF NOT public.flag_bank_card_offer_capture_review(v_order, v_merchant, v_transaction)
      THEN RAISE EXCEPTION 'Scoped capture mismatch did not accept an idempotent retry'; END IF;
    IF (SELECT count(*) FROM public.reconciliation_review
      WHERE issue_type = 'payment_match_ambiguous' AND merchant_id = v_merchant
        AND order_id = v_order AND txn_id = v_transaction AND paystack_ref = v_reference) <> 1
      OR (SELECT status FROM public.transactions WHERE id = v_transaction) <> 'pending'
    THEN RAISE EXCEPTION 'Scoped capture review must be idempotent and leave settlement pending'; END IF;
    -- Undo the capture review before the independent terminal review checks.
    RAISE EXCEPTION 'capture_review_test_complete';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'capture_review_test_complete' THEN RAISE; END IF;
  END;
  IF NOT public.flag_bank_card_offer_terminal_review(v_order, v_merchant, v_transaction, 'reversed')
    THEN RAISE EXCEPTION 'Unable to review a reversed initialized attempt'; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', v_user,
    'storefront_order_context', 'route', 'storefront_order_merchant_id', v_merchant)::text, true);
  v_attempt := public.claim_bank_card_offer_attempt(v_order, v_merchant, 9500, v_hash, 'test', 100, 0);
  IF v_attempt->>'claimed' IS DISTINCT FROM 'false' OR v_attempt->>'checkoutUrl' IS NOT NULL
    THEN RAISE EXCEPTION 'Terminal attempt advertised a stale checkout URL'; END IF;
  DECLARE v_review_id uuid;
  BEGIN
    SELECT id INTO STRICT v_review_id FROM public.reconciliation_review
      WHERE txn_id = v_transaction AND resolved_at IS NULL;
    IF public.restore_bank_card_offer_checkout_url(v_review_id, 'https://checkout.paystack.com/trx/test')
      OR NOT public.retire_bank_card_offer_initialization(v_review_id, 'Paystack confirms this hosted session cannot charge')
    THEN RAISE EXCEPTION 'Initialized terminal attempt must retire without restoring the old URL'; END IF;
  END;
  v_attempt := public.claim_bank_card_offer_attempt(v_order, v_merchant, 9500, v_hash, 'test', 100, 0);
  IF v_attempt->>'claimed' IS DISTINCT FROM 'true' OR v_attempt->>'reference' = v_reference
    THEN RAISE EXCEPTION 'Initialized terminal attempt could not be replaced'; END IF;
  v_reference := v_attempt->>'reference';
  SELECT id INTO STRICT v_transaction FROM public.transactions WHERE gateway_reference = v_reference;
  BEGIN
    UPDATE public.transactions SET status = 'completed' WHERE id = v_transaction;
    RAISE EXCEPTION 'An unproved bank capture became completed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bank_card_offer_payment_not_verified' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated',
    'storefront_order_context', 'route', 'storefront_order_merchant_id', v_merchant)::text, true);
  v_evidence := jsonb_build_object('contractVersion', 'paystack_verified_card_v1',
    'cardChannel', 'card', 'cardBrand', 'visa', 'currency', 'NGN', 'domain', 'test',
    'reference', v_reference, 'amountKobo', 9500, 'customerEmail', 'bank-attempt-buyer@example.test',
    'acceptedFilterPolicyHash', v_hash, 'issuerName', 'Wema Bank', 'providerVerificationId', '42');
  IF public.get_bank_card_offer_verification_context(v_order, v_merchant, v_transaction)->>'completedGatewayResponse' IS NOT NULL
    THEN RAISE EXCEPTION 'Unapproved bank-offer payments must verify against Paystack'; END IF;
  v_gateway_response := jsonb_build_object('reference', v_reference, 'status', 'success',
    'currency', 'NGN', 'amount', 9500.0, 'domain', 'test', 'id', '42');
  IF public.approve_bank_card_offer_capture(v_order, v_merchant, v_transaction,
    jsonb_set(v_evidence, '{issuerName}', '"Sterling Bank"'), v_gateway_response)
    OR public.approve_bank_card_offer_capture(v_order, v_merchant, v_transaction,
      v_evidence, jsonb_set(v_gateway_response, '{amount}', '9600'))
    OR NOT public.approve_bank_card_offer_capture(v_order, v_merchant, v_transaction,
      v_evidence, v_gateway_response)
  THEN RAISE EXCEPTION 'Only an exact verified capture should be approved'; END IF;
  IF public.get_bank_card_offer_verification_context(v_order, v_merchant, v_transaction)
    #>> '{completedGatewayResponse,reference}' IS DISTINCT FROM v_reference
  THEN RAISE EXCEPTION 'Pending completion must retain saved provider evidence'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions
    WHERE id = v_transaction AND status = 'pending'
      AND metadata->>'guest_provider_confirmed' = 'true'
      AND metadata->>'guest_provider_confirmed_at' IS NOT NULL
  ) THEN RAISE EXCEPTION 'A verified pending capture must be eligible for the wedge sweep'; END IF;
  IF EXISTS (SELECT 1 FROM public.claim_paid_bank_card_offer_recheck() c WHERE c.transaction_id = v_transaction)
  THEN RAISE EXCEPTION 'A pending capture entered the paid recheck queue'; END IF;
  BEGIN
    IF NOT public.flag_bank_card_offer_terminal_review(v_order, v_merchant, v_transaction, 'reversed')
      OR NOT public.flag_bank_card_offer_terminal_review(v_order, v_merchant, v_transaction, 'abandoned')
    THEN RAISE EXCEPTION 'Approved capture reversal was not recorded'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.reconciliation_review
      WHERE txn_id = v_transaction AND metadata->>'provider_status' = 'reversed'
    ) THEN RAISE EXCEPTION 'A later terminal response cleared the reversal'; END IF;
    BEGIN
      UPDATE public.transactions SET status = 'completed' WHERE id = v_transaction;
      RAISE EXCEPTION 'Reversed approved capture became completed';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'bank_card_offer_payment_reversed' THEN RAISE; END IF;
    END;
    RAISE EXCEPTION USING ERRCODE = 'BX005', MESSAGE = 'Roll back the test reversal';
  EXCEPTION WHEN SQLSTATE 'BX005' THEN NULL;
  END;
  UPDATE public.transactions SET status = 'completed'
    WHERE id = v_transaction;
  IF public.get_bank_card_offer_verification_context(v_order, v_merchant, v_transaction)
    #>> '{completedGatewayResponse,reference}' IS DISTINCT FROM v_reference
  THEN RAISE EXCEPTION 'Completed capture could not replay its approved evidence'; END IF;
  UPDATE public.orders SET payment_status = 'paid' WHERE id = v_order;

  IF has_function_privilege('authenticated', 'public.claim_paid_bank_card_offer_recheck()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.claim_paid_bank_card_offer_recheck()', 'EXECUTE')
  THEN RAISE EXCEPTION 'Only the service worker may claim paid captures'; END IF;
  SET LOCAL ROLE service_role;
  IF NOT EXISTS (
    SELECT 1 FROM public.claim_paid_bank_card_offer_recheck() c
    WHERE c.transaction_id = v_transaction AND c.merchant_id = v_merchant
      AND c.order_id = v_order AND c.gateway_reference = v_reference
  ) THEN RAISE EXCEPTION 'Paid captures must be eligible for a scheduled reversal check'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.claim_paid_bank_card_offer_recheck() c WHERE c.transaction_id = v_transaction
  ) THEN RAISE EXCEPTION 'Another worker must not claim the same capture immediately'; END IF;
  RESET ROLE;

  BEGIN
    INSERT INTO public.transactions (id, order_id, merchant_id, transaction_type, amount,
      currency, status, gateway, gateway_reference)
    VALUES (gen_random_uuid(), v_order, v_merchant, 'payment', 95,
      'NGN', 'completed', 'paystack', 'BANK-OFFER-FALLBACK-FIXTURE');
    RAISE EXCEPTION 'A snapshotted bank offer accepted a second payment leg';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bank_card_offer_payment_not_verified' THEN RAISE; END IF;
  END;

  IF has_function_privilege('authenticated', 'public.get_bank_card_offer_webhook_transaction(text)', 'EXECUTE')
    OR public.get_bank_card_offer_webhook_transaction(v_reference)->>'merchant_id' IS DISTINCT FROM v_merchant::text
    OR public.get_bank_card_offer_webhook_transaction('BANK-OFFER-FALLBACK-FIXTURE') IS NOT NULL
  THEN RAISE EXCEPTION 'Webhook lookup returned a payment outside the saved merchant attempt'; END IF;

  SET LOCAL ROLE service_role;
  IF public.get_bank_card_offer_refundable_amount(v_order, v_merchant, v_transaction, v_reference) IS DISTINCT FROM 9500
    OR public.get_bank_card_offer_refundable_amount(v_order, v_merchant, v_transaction, 'BCO-other') IS NOT NULL
  THEN RAISE EXCEPTION 'Refund worker must read only the verified discounted capture'; END IF;
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.get_bank_card_offer_refundable_amount(v_order, v_merchant, v_transaction, v_reference);
    RAISE EXCEPTION 'A buyer session accessed the service-only refund lookup';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  IF NOT public.bank_card_offer_refund_capture_matches(v_order, v_merchant, v_transaction, v_reference, 9500)
    OR public.bank_card_offer_refund_capture_matches(v_order, v_merchant, v_transaction, v_reference, 10000)
  THEN RAISE EXCEPTION 'Refund must use the discounted capture'; END IF;
  IF NOT public.flag_bank_card_offer_terminal_review(v_order, v_merchant, v_transaction, 'failed')
  THEN RAISE EXCEPTION 'The sweep must record a confirmed failed status for a completed attempt'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.reconciliation_review
    WHERE txn_id = v_transaction AND metadata->>'source' = 'bank_card_offer_initialization'
      AND metadata->>'provider_status' = 'failed' AND resolved_at IS NULL
  ) THEN RAISE EXCEPTION 'Terminal status must use the review that suppresses stale checkout URLs'; END IF;
  IF NOT public.flag_bank_card_offer_terminal_review(v_order, v_merchant, v_transaction, 'reversed')
  THEN RAISE EXCEPTION 'Unable to persist the capture reversal before refund verification'; END IF;
  UPDATE private.bank_card_offer_payment_attempts SET paid_recheck_after = now()
    WHERE transaction_id = v_transaction;
  SET LOCAL ROLE service_role;
  IF EXISTS (
    SELECT 1 FROM public.claim_paid_bank_card_offer_recheck() c WHERE c.transaction_id = v_transaction
  ) THEN RAISE EXCEPTION 'A recorded reversal must leave the paid recheck queue'; END IF;
  RESET ROLE;
  IF public.bank_card_offer_refund_capture_matches(v_order, v_merchant, v_transaction, v_reference, 9500)
    OR public.get_bank_card_offer_refundable_amount(v_order, v_merchant, v_transaction, v_reference) IS NOT NULL
  THEN RAISE EXCEPTION 'Reconciled reversal must block another cancellation refund'; END IF;

  -- Inventory can leave a completed transaction attached to a pending order.
  UPDATE public.orders SET payment_status = 'pending' WHERE id = v_order;
  BEGIN
    UPDATE public.orders SET payment_status = 'paid' WHERE id = v_order;
    RAISE EXCEPTION 'Completed replay repaid an order after its reversal';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'bank_card_offer_payment_not_verified' THEN RAISE; END IF;
  END;
  IF (SELECT status FROM public.transactions WHERE id = v_transaction) <> 'completed'
    OR (SELECT payment_status FROM public.orders WHERE id = v_order) <> 'pending'
  THEN RAISE EXCEPTION 'A reversed replay changed settlement state'; END IF;
END;
$$;

ROLLBACK;
