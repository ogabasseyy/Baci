DO $$
DECLARE
  v_fixture jsonb := current_setting('test.bank_offer_attempt_fixture')::jsonb;
  v_merchant uuid := (v_fixture->>'merchant')::uuid;
  v_order uuid := (v_fixture->>'order')::uuid;
  v_capture jsonb := current_setting('test.bank_offer_capture_fixture')::jsonb;
  v_reference text := v_capture->>'reference';
  v_transaction uuid := (v_capture->>'transaction')::uuid;
  v_hash text := v_fixture->>'hash';
  v_evidence jsonb;
  v_gateway_response jsonb;
BEGIN
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
END;
$$;
