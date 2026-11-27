-- A terminal provider status stops polling and hides the stale checkout URL.
-- The attempt remains fenced until Operations confirms it cannot charge.
CREATE FUNCTION public.flag_bank_card_offer_terminal_review(
  p_order_id uuid, p_merchant_id uuid, p_transaction_id uuid, p_status text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_context jsonb;
BEGIN
  v_context := public.get_bank_card_offer_verification_context(p_order_id, p_merchant_id, p_transaction_id);
  IF v_context IS NULL OR COALESCE(p_status, '') NOT IN ('failed', 'abandoned', 'cancelled')
  THEN RETURN false; END IF;

  INSERT INTO public.reconciliation_review (issue_type, merchant_id, order_id, txn_id, paystack_ref, reason, metadata)
  SELECT 'gateway_payment_wedge_requires_review', p_merchant_id, p_order_id, t.id,
    v_context->>'reference',
    'Paystack reported a terminal status for a bank-offer checkout. Confirm the reference cannot charge before retiring it.',
    jsonb_build_object('source', 'bank_card_offer_initialization', 'provider_status', p_status)
  FROM private.bank_card_offer_payment_attempts a
  JOIN public.transactions t ON t.id = a.transaction_id
  WHERE a.order_id = p_order_id AND a.transaction_id = p_transaction_id
    AND a.verified_evidence IS NULL AND t.status = 'pending'
  ON CONFLICT DO NOTHING;

  -- An earlier initialization error may already have opened the review.
  UPDATE public.reconciliation_review r
  SET metadata = r.metadata || jsonb_build_object('provider_status', p_status)
  WHERE r.issue_type = 'gateway_payment_wedge_requires_review'
    AND r.order_id = p_order_id AND r.merchant_id = p_merchant_id
    AND r.txn_id = p_transaction_id AND r.paystack_ref = v_context->>'reference'
    AND r.metadata->>'source' = 'bank_card_offer_initialization' AND r.resolved_at IS NULL;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.flag_bank_card_offer_terminal_review(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.flag_bank_card_offer_terminal_review(uuid, uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_bank_card_offer_attempt(
  p_order_id uuid, p_merchant_id uuid, p_amount_kobo bigint, p_policy_hash text,
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

  SELECT CASE WHEN EXISTS (
      SELECT 1 FROM public.reconciliation_review r
      WHERE r.txn_id = t.id AND r.merchant_id = t.merchant_id AND r.order_id = a.order_id
        AND r.issue_type = 'gateway_payment_wedge_requires_review'
        AND r.metadata->>'source' = 'bank_card_offer_initialization'
        AND r.metadata->>'provider_status' IN ('failed', 'abandoned', 'cancelled')
    ) THEN NULL ELSE a.checkout_url END AS checkout_url, a.policy_hash, a.provider_domain, t.gateway_reference
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

  IF ((v_context #>> '{quote,endsAt}')::timestamptz > now()) IS NOT TRUE
    OR EXISTS (SELECT 1 FROM public.transactions
      WHERE order_id = p_order_id AND transaction_type = 'payment'
        AND status IN ('pending', 'processing', 'completed'))
    OR EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id
      AND (COALESCE(amount_paid, 0) <> 0 OR COALESCE(wallet_amount_used, 0) <> 0))
  THEN
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

CREATE OR REPLACE FUNCTION public.restore_bank_card_offer_checkout_url(p_review_id uuid, p_checkout_url text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_review record;
BEGIN
  IF NOT private.bank_card_offer_checkout_url_valid(p_checkout_url) THEN RETURN false; END IF;
  SELECT id, merchant_id, order_id, txn_id, paystack_ref INTO v_review
  FROM public.reconciliation_review
  WHERE id = p_review_id AND issue_type = 'gateway_payment_wedge_requires_review'
    AND metadata->>'source' = 'bank_card_offer_initialization' AND resolved_at IS NULL
    AND metadata->>'provider_status' IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE private.bank_card_offer_payment_attempts a SET checkout_url = p_checkout_url
  FROM public.transactions t, public.orders o
  WHERE a.order_id = v_review.order_id AND a.transaction_id = v_review.txn_id
    AND t.id = a.transaction_id AND t.gateway_reference = v_review.paystack_ref
    AND o.id = a.order_id AND t.merchant_id = v_review.merchant_id AND o.merchant_id = v_review.merchant_id
    AND t.status = 'pending' AND o.payment_status = 'pending' AND o.cancelled_at IS NULL
    AND a.verified_evidence IS NULL AND (a.checkout_url IS NULL OR a.checkout_url = p_checkout_url);
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.reconciliation_review SET resolved_at = now() WHERE id = v_review.id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.retire_bank_card_offer_initialization(
  p_review_id uuid, p_provider_confirmation text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_review record;
  v_transaction_id uuid;
BEGIN
  IF NULLIF(btrim(p_provider_confirmation), '') IS NULL OR length(p_provider_confirmation) > 500
    THEN RETURN false; END IF;
  SELECT id, merchant_id, order_id, txn_id, paystack_ref, metadata INTO v_review
  FROM public.reconciliation_review
  WHERE id = p_review_id AND issue_type = 'gateway_payment_wedge_requires_review'
    AND metadata->>'source' = 'bank_card_offer_initialization' AND resolved_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || v_review.order_id::text, 0));
  PERFORM 1 FROM public.orders WHERE id = v_review.order_id AND merchant_id = v_review.merchant_id
    AND payment_status = 'pending' AND cancelled_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  DELETE FROM private.bank_card_offer_payment_attempts a
  USING public.transactions t
  WHERE a.order_id = v_review.order_id AND a.transaction_id = v_review.txn_id
    AND t.id = a.transaction_id AND t.gateway_reference = v_review.paystack_ref
    AND t.merchant_id = v_review.merchant_id AND t.status = 'pending'
    AND t.order_id = v_review.order_id AND t.gateway = 'paystack' AND t.transaction_type = 'payment'
    AND (a.checkout_url IS NULL OR v_review.metadata->>'provider_status' IN ('failed', 'abandoned', 'cancelled'))
    AND a.verified_evidence IS NULL
  RETURNING a.transaction_id INTO v_transaction_id;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.transactions SET status = 'cancelled', updated_at = now() WHERE id = v_transaction_id;
  UPDATE public.orders SET payment_status = 'unpaid', updated_at = now() WHERE id = v_review.order_id;
  UPDATE public.reconciliation_review SET resolved_at = now(),
    metadata = metadata || jsonb_build_object('provider_confirmation', p_provider_confirmation)
    WHERE id = p_review_id;
  RETURN true;
END;
$$;
