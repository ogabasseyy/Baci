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
BEGIN
  IF has_table_privilege('authenticated', 'private.bank_card_offer_payment_attempts', 'SELECT')
    OR has_function_privilege('anon', 'public.claim_bank_card_offer_attempt(uuid,uuid,bigint,text,text,bigint,bigint)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.bank_card_offer_refund_capture_matches(uuid,uuid,uuid,text,bigint)', 'EXECUTE')
  THEN RAISE EXCEPTION 'bank offer attempt privileges are too broad'; END IF;

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
  IF public.get_bank_card_offer_checkout_replay(v_merchant, 'bank-test-key', v_hash)->>'id' IS DISTINCT FROM v_order::text THEN
    RAISE EXCEPTION 'Checkout replay should return the saved order';
  END IF;
  BEGIN
    PERFORM public.get_bank_card_offer_checkout_replay(v_merchant, 'bank-test-key', repeat('b', 64));
    RAISE EXCEPTION 'A different bank checkout body replayed the old order';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'checkout_idempotency_conflict' THEN RAISE; END IF;
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
  IF NOT public.record_bank_card_offer_checkout_url(v_order, v_merchant, v_reference, 'https://checkout.paystack.com/trx/test') THEN
    RAISE EXCEPTION 'The attempt must retain its verified checkout URL';
  END IF;
  v_attempt := public.claim_bank_card_offer_attempt(v_order, v_merchant, 9500, v_hash, 'test', 100, 0);
  IF v_attempt->>'claimed' <> 'false' OR v_attempt->>'reference' <> v_reference
    OR v_attempt->>'checkoutUrl' <> 'https://checkout.paystack.com/trx/test'
  THEN RAISE EXCEPTION 'A retry must replay its existing Paystack reference'; END IF;
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
  IF public.approve_bank_card_offer_capture(v_order, v_merchant, v_transaction,
    jsonb_set(v_evidence, '{issuerName}', '"Sterling Bank"'))
    OR NOT public.approve_bank_card_offer_capture(v_order, v_merchant, v_transaction, v_evidence)
  THEN RAISE EXCEPTION 'Only an exact verified capture should be approved'; END IF;
  UPDATE public.transactions SET status = 'completed' WHERE id = v_transaction;
  UPDATE public.orders SET payment_status = 'paid' WHERE id = v_order;

  IF NOT public.bank_card_offer_refund_capture_matches(v_order, v_merchant, v_transaction, v_reference, 9500)
    OR public.bank_card_offer_refund_capture_matches(v_order, v_merchant, v_transaction, v_reference, 10000)
  THEN RAISE EXCEPTION 'Refund must use the discounted capture'; END IF;
END;
$$;

ROLLBACK;
