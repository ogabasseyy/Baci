DO $$
DECLARE
  v_fixture jsonb := current_setting('test.bank_offer_attempt_fixture')::jsonb;
  v_merchant uuid := (v_fixture->>'merchant')::uuid;
  v_order uuid := (v_fixture->>'order')::uuid;
  v_user uuid := (v_fixture->>'user')::uuid;
  v_hash text := v_fixture->>'hash';
  v_attempt jsonb;
  v_reference text;
  v_transaction uuid;
BEGIN
  BEGIN
    UPDATE public.orders SET payment_status = 'unpaid' WHERE id = v_order;
    UPDATE public.products SET manage_stock = true, stock_quantity = 3
    WHERE id = (SELECT product_id FROM public.order_items WHERE order_id = v_order);
    UPDATE private.bank_card_offer_order_snapshots
    SET offer_quote = jsonb_set(offer_quote, '{endsAt}', to_jsonb(clock_timestamp() - interval '1 second'))
    WHERE order_id = v_order;
    v_attempt := public.claim_bank_card_offer_attempt(v_order, v_merchant, 9500, v_hash, 'test', 100, 0);
    IF v_attempt IS DISTINCT FROM '{"retired":true}'::jsonb
      OR NOT EXISTS (SELECT 1 FROM public.orders WHERE id = v_order
        AND shipping_status = 'cancelled' AND cancelled_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM public.transactions WHERE order_id = v_order)
      OR (SELECT p.stock_quantity FROM public.products p
        JOIN public.order_items oi ON oi.product_id = p.id
        WHERE oi.order_id = v_order) IS DISTINCT FROM 4
    THEN RAISE EXCEPTION 'An expired unclaimed order must cancel without starting a payment'; END IF;
    RAISE EXCEPTION 'expired_checkout_test_complete';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'expired_checkout_test_complete' THEN RAISE; END IF;
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
  BEGIN
    IF NOT public.record_bank_card_offer_dispute(v_reference, 'charge.dispute.create', '101', 'open')
    THEN RAISE EXCEPTION 'Unable to record checkout dispute'; END IF;
    v_attempt := public.claim_bank_card_offer_attempt(v_order, v_merchant, 9500, v_hash, 'test', 100, 0);
    IF v_attempt->>'claimed' IS DISTINCT FROM 'false'
      OR v_attempt->>'reference' IS DISTINCT FROM v_reference
      OR v_attempt->>'checkoutUrl' IS NOT NULL
      OR public.record_bank_card_offer_checkout_url(v_order, v_merchant, v_reference, 'https://checkout.paystack.com/trx/test?state=one%2Btwo&x=1')
    THEN RAISE EXCEPTION 'An open dispute exposed a hosted checkout URL'; END IF;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated',
      'storefront_order_context', 'route', 'storefront_order_merchant_id', v_merchant)::text, true);
    IF NOT public.flag_bank_card_offer_terminal_review(v_order, v_merchant, v_transaction, 'reversed')
      OR NOT public.record_bank_card_offer_dispute(v_reference, 'charge.dispute.resolve', '101', 'won')
    THEN RAISE EXCEPTION 'Unable to resolve checkout dispute after reversal'; END IF;
    IF EXISTS (SELECT 1 FROM private.bank_card_offer_payment_attempts
      WHERE transaction_id = v_transaction AND dispute_hold_at IS NOT NULL)
    THEN RAISE EXCEPTION 'A merchant win should clear the dispute hold'; END IF;
    PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', v_user,
      'storefront_order_context', 'route', 'storefront_order_merchant_id', v_merchant)::text, true);
    v_attempt := public.claim_bank_card_offer_attempt(v_order, v_merchant, 9500, v_hash, 'test', 100, 0);
    IF v_attempt->>'claimed' IS DISTINCT FROM 'false'
      OR v_attempt->>'reference' IS DISTINCT FROM v_reference
      OR v_attempt->>'checkoutUrl' IS NOT NULL
      OR public.record_bank_card_offer_checkout_url(v_order, v_merchant, v_reference, 'https://checkout.paystack.com/trx/test?state=one%2Btwo&x=1')
    THEN RAISE EXCEPTION 'A won dispute restored the URL of a reversed attempt'; END IF;
    RAISE EXCEPTION 'checkout_dispute_test_complete';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'checkout_dispute_test_complete' THEN RAISE; END IF;
  END;
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

  PERFORM set_config('test.bank_offer_capture_fixture',
    jsonb_build_object('reference', v_reference, 'transaction', v_transaction)::text, true);
END;
$$;
