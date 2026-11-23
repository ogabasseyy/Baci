CREATE OR REPLACE FUNCTION public.claim_bank_card_offer_attempt(  p_order_id uuid, p_merchant_id uuid, p_amount_kobo bigint, p_policy_hash text,
  p_domain text, p_platform_fee_kobo bigint, p_retained_shipping_kobo bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_context jsonb;
  v_attempt record;
  v_transaction_id uuid;
  v_reference text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || p_order_id::text, 0));
  PERFORM 1 FROM public.orders WHERE id = p_order_id AND merchant_id = p_merchant_id FOR UPDATE;
  v_context := public.get_bank_card_offer_checkout_context(p_order_id, p_merchant_id);
  IF v_context IS NULL OR (v_context->>'amountKobo')::bigint IS DISTINCT FROM p_amount_kobo
    OR COALESCE(p_policy_hash, '') !~ '^[0-9a-f]{64}$'
    OR COALESCE(p_domain, '') NOT IN ('test', 'live')
    OR p_platform_fee_kobo IS NULL OR p_retained_shipping_kobo IS NULL
    OR least(p_platform_fee_kobo, p_retained_shipping_kobo) < 0
    OR p_platform_fee_kobo + p_retained_shipping_kobo > p_amount_kobo
    OR NULLIF(v_context->>'subaccount', '') IS NULL
  THEN
    RAISE EXCEPTION 'bank_card_offer_attempt_unavailable';
  END IF;

  SELECT CASE WHEN a.dispute_hold_at IS NOT NULL
      OR private.has_bank_card_offer_terminal_checkout_review(t.id, t.merchant_id, a.order_id, t.gateway_reference)
    THEN NULL ELSE a.checkout_url END AS checkout_url, a.policy_hash, a.provider_domain, t.gateway_reference
    INTO v_attempt FROM private.bank_card_offer_payment_attempts a
    JOIN public.transactions t ON t.id = a.transaction_id
    WHERE a.order_id = p_order_id;
  IF FOUND THEN
    IF v_attempt.policy_hash IS DISTINCT FROM p_policy_hash OR v_attempt.provider_domain IS DISTINCT FROM p_domain THEN
      RAISE EXCEPTION 'bank_card_offer_attempt_conflict';
    END IF;
    RETURN jsonb_build_object('claimed', false, 'reference', v_attempt.gateway_reference,
      'checkoutUrl', v_attempt.checkout_url);
  END IF;

  IF EXISTS (SELECT 1 FROM public.transactions
      WHERE order_id = p_order_id AND transaction_type = 'payment'
        AND status IN ('pending', 'processing', 'completed'))
    OR EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id
      AND (COALESCE(amount_paid, 0) <> 0 OR COALESCE(wallet_amount_used, 0) <> 0))
  THEN
    RAISE EXCEPTION 'bank_card_offer_attempt_unavailable';
  END IF;

  -- A saved attempt above keeps its reference across the deadline. An
  -- unclaimed checkout can be retired through the ordinary buyer
  -- cancellation path under the same lock, releasing reserved stock.
  IF (v_context #>> '{quote,endsAt}')::timestamptz <= clock_timestamp() THEN
    IF public.cancel_order_as_customer(p_order_id, 'Bank card offer expired before payment started') THEN
      RETURN jsonb_build_object('retired', true);
    END IF;
    RAISE EXCEPTION 'bank_card_offer_attempt_unavailable';
  END IF;
  IF v_context #>> '{quote,endsAt}' IS NULL THEN
    RAISE EXCEPTION 'bank_card_offer_attempt_unavailable';
  END IF;

  v_reference := 'BCO-' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.transactions (order_id, merchant_id, transaction_type, amount, currency,
    status, gateway, gateway_reference, platform_fee, merchant_amount, metadata)
  VALUES (p_order_id, p_merchant_id, 'payment', p_amount_kobo::numeric / 100, 'NGN',
    'pending', 'paystack', v_reference, p_platform_fee_kobo::numeric / 100,
    (p_amount_kobo - p_platform_fee_kobo - p_retained_shipping_kobo)::numeric / 100,
    jsonb_build_object('customer_email', v_context->>'customerEmail',
      'retained_shipping_kobo', p_retained_shipping_kobo))
  RETURNING id INTO v_transaction_id;
  INSERT INTO private.bank_card_offer_payment_attempts (order_id, transaction_id, policy_hash, provider_domain)
    VALUES (p_order_id, v_transaction_id, p_policy_hash, p_domain);
  UPDATE public.orders SET payment_status = 'pending', updated_at = now() WHERE id = p_order_id;
  RETURN jsonb_build_object('claimed', true, 'reference', v_reference, 'checkoutUrl', NULL);
END;
$$;
