CREATE TABLE private.bank_card_offer_payment_attempts (
  order_id uuid PRIMARY KEY REFERENCES private.bank_card_offer_order_snapshots(order_id) ON DELETE RESTRICT,
  transaction_id uuid UNIQUE NOT NULL REFERENCES public.transactions(id) ON DELETE RESTRICT,
  policy_hash text NOT NULL CHECK (policy_hash ~ '^[0-9a-f]{64}$'),
  provider_domain text NOT NULL CHECK (provider_domain IN ('test', 'live')),
  checkout_url text,
  verified_evidence jsonb
);
ALTER TABLE private.bank_card_offer_payment_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.bank_card_offer_payment_attempts FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_bank_card_offer_checkout_context(p_order_id uuid, p_merchant_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('quote', s.offer_quote, 'amountKobo', s.payable_kobo,
    'customerEmail', s.customer_email, 'subaccount', m.paystack_subaccount_code, 'slug', m.slug)
  FROM private.bank_card_offer_order_snapshots s
  JOIN public.orders o ON o.id = s.order_id AND o.merchant_id = s.merchant_id
  JOIN public.customers c ON c.id = o.customer_id AND c.merchant_id = s.merchant_id
  JOIN public.merchants m ON m.id = s.merchant_id
  LEFT JOIN public.merchant_feature_settings fs ON fs.merchant_id = m.id
  WHERE s.order_id = p_order_id AND s.merchant_id = p_merchant_id
    AND c.user_id = auth.uid()
    AND auth.jwt()->>'storefront_order_context' = 'route'
    AND auth.jwt()->>'storefront_order_merchant_id' = s.merchant_id::text
    AND o.payment_method = 'bank_card_offer' AND o.currency = 'NGN'
    AND o.total * 100 = s.payable_kobo AND lower(btrim(o.customer_email)) = s.customer_email
    AND o.payment_status IN ('unpaid', 'pending') AND o.shipping_status = 'pending'
    AND o.cancelled_at IS NULL AND COALESCE(fs.paystack_enabled, true);
$$;

CREATE FUNCTION public.claim_bank_card_offer_attempt(
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

  SELECT a.checkout_url, a.policy_hash, a.provider_domain, t.gateway_reference
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

CREATE FUNCTION public.record_bank_card_offer_checkout_url(
  p_order_id uuid, p_merchant_id uuid, p_reference text, p_checkout_url text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.get_bank_card_offer_checkout_context(p_order_id, p_merchant_id) IS NULL
    OR COALESCE(p_checkout_url, '') !~ '^https://checkout[.]paystack[.]com/[A-Za-z0-9._/-]+$'
  THEN RETURN false; END IF;
  UPDATE private.bank_card_offer_payment_attempts a SET checkout_url = p_checkout_url
  FROM public.transactions t
  WHERE a.order_id = p_order_id AND t.id = a.transaction_id
    AND t.gateway_reference = p_reference AND a.checkout_url IS NULL;
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.get_bank_card_offer_verification_context(
  p_order_id uuid, p_merchant_id uuid, p_transaction_id uuid
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('quote', ctx.quote, 'amountKobo', ctx.amount_kobo,
    'customerEmail', ctx.customer_email, 'reference', ctx.reference,
    'acceptedFilterPolicyHash', a.policy_hash, 'domain', a.provider_domain)
  FROM private.bank_card_offer_payment_attempts a
  CROSS JOIN LATERAL private.read_bank_card_offer_payment_context(p_order_id, p_merchant_id, p_transaction_id) ctx
  WHERE a.order_id = p_order_id AND a.transaction_id = p_transaction_id
    AND auth.uid() IS NULL
    AND auth.jwt()->>'storefront_order_context' = 'route'
    AND auth.jwt()->>'storefront_order_merchant_id' = p_merchant_id::text;
$$;

CREATE FUNCTION public.approve_bank_card_offer_capture(
  p_order_id uuid, p_merchant_id uuid, p_transaction_id uuid, p_evidence jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_context jsonb := public.get_bank_card_offer_verification_context(p_order_id, p_merchant_id, p_transaction_id);
BEGIN
  IF v_context IS NULL
    OR p_evidence->>'contractVersion' IS DISTINCT FROM 'paystack_verified_card_v1'
    OR p_evidence->>'cardChannel' IS DISTINCT FROM 'card'
    OR p_evidence->>'currency' IS DISTINCT FROM 'NGN'
    OR p_evidence->>'domain' IS DISTINCT FROM v_context->>'domain'
    OR p_evidence->>'reference' IS DISTINCT FROM v_context->>'reference'
    OR p_evidence->>'amountKobo' IS DISTINCT FROM v_context->>'amountKobo'
    OR p_evidence->>'customerEmail' IS DISTINCT FROM v_context->>'customerEmail'
    OR p_evidence->>'acceptedFilterPolicyHash' IS DISTINCT FROM v_context->>'acceptedFilterPolicyHash'
    OR p_evidence->>'issuerName' IS DISTINCT FROM v_context #>> '{quote,paymentPolicy,issuerName}'
    OR COALESCE((v_context #> '{quote,paymentPolicy,cardBrands}') ? (p_evidence->>'cardBrand'), false) IS NOT TRUE
    OR COALESCE(p_evidence->>'providerVerificationId', '') !~ '^[1-9][0-9]*$'
  THEN RETURN false; END IF;
  UPDATE private.bank_card_offer_payment_attempts a SET verified_evidence = p_evidence
    WHERE a.order_id = p_order_id AND a.transaction_id = p_transaction_id
      AND (a.verified_evidence IS NULL OR a.verified_evidence = p_evidence);
  RETURN FOUND;
END;
$$;

CREATE FUNCTION private.guard_bank_card_offer_payment_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.transaction_type = 'payment' AND NEW.status = 'completed'
    AND (NEW.gateway_reference LIKE 'BCO-%' OR EXISTS (
      SELECT 1 FROM private.bank_card_offer_order_snapshots s WHERE s.order_id = NEW.order_id
    ))
    AND NOT EXISTS (
      SELECT 1 FROM private.bank_card_offer_payment_attempts a
      JOIN private.bank_card_offer_order_snapshots s ON s.order_id = a.order_id
      WHERE a.transaction_id = NEW.id AND a.order_id = NEW.order_id
        AND s.merchant_id = NEW.merchant_id AND NEW.currency = 'NGN' AND NEW.gateway = 'paystack'
        AND NEW.amount * 100 = s.payable_kobo
        AND a.verified_evidence->>'reference' = NEW.gateway_reference
    )
  THEN RAISE EXCEPTION 'bank_card_offer_payment_not_verified'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_bank_card_offer_payment_completion
  BEFORE INSERT OR UPDATE OF status, amount, gateway, gateway_reference, currency, merchant_id, order_id, transaction_type
  ON public.transactions FOR EACH ROW EXECUTE FUNCTION private.guard_bank_card_offer_payment_completion();

REVOKE ALL ON FUNCTION private.guard_bank_card_offer_payment_completion() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_bank_card_offer_checkout_context(uuid, uuid),
  public.claim_bank_card_offer_attempt(uuid, uuid, bigint, text, text, bigint, bigint),
  public.record_bank_card_offer_checkout_url(uuid, uuid, text, text),
  public.get_bank_card_offer_verification_context(uuid, uuid, uuid),
  public.approve_bank_card_offer_capture(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_bank_card_offer_checkout_context(uuid, uuid),
  public.claim_bank_card_offer_attempt(uuid, uuid, bigint, text, text, bigint, bigint),
  public.record_bank_card_offer_checkout_url(uuid, uuid, text, text),
  public.get_bank_card_offer_verification_context(uuid, uuid, uuid),
  public.approve_bank_card_offer_capture(uuid, uuid, uuid, jsonb)
  TO authenticated;

-- The cancellation worker uses the exact captured leg, including its discount.
-- Require a saved verified attempt before a bank-offer leg reaches Paystack.
CREATE FUNCTION public.bank_card_offer_refund_capture_matches(
  p_order_id uuid, p_merchant_id uuid, p_transaction_id uuid, p_reference text, p_amount_kobo bigint
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.bank_card_offer_payment_attempts a
    JOIN private.bank_card_offer_order_snapshots s ON s.order_id = a.order_id
    JOIN public.transactions t ON t.id = a.transaction_id
    WHERE s.order_id = p_order_id AND s.merchant_id = p_merchant_id
      AND t.id = p_transaction_id AND t.order_id = s.order_id AND t.merchant_id = s.merchant_id
      AND t.status = 'completed' AND t.transaction_type = 'payment'
      AND t.gateway = 'paystack' AND t.currency = 'NGN' AND t.amount * 100 = s.payable_kobo
      AND s.payable_kobo = p_amount_kobo AND t.gateway_reference = p_reference
      AND a.verified_evidence->>'reference' = p_reference
  );
$$;
REVOKE ALL ON FUNCTION public.bank_card_offer_refund_capture_matches(uuid, uuid, uuid, text, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.bank_card_offer_refund_capture_matches(uuid, uuid, uuid, text, bigint)
  TO service_role;

CREATE FUNCTION private.guard_bank_card_offer_order_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.payment_method = 'bank_card_offer'
    AND (NEW.payment_method IS DISTINCT FROM OLD.payment_method
      OR (NEW.payment_status IN ('paid', 'partially_paid', 'bnpl_approved')
        AND NEW.payment_status IS DISTINCT FROM OLD.payment_status))
    AND EXISTS (SELECT 1 FROM private.bank_card_offer_order_snapshots WHERE order_id = OLD.id)
  THEN
    IF NEW.payment_method IS DISTINCT FROM OLD.payment_method
      OR NEW.payment_status <> 'paid'
      OR NOT EXISTS (
        SELECT 1 FROM private.bank_card_offer_payment_attempts a
        WHERE a.order_id = OLD.id AND a.verified_evidence IS NOT NULL
      )
    THEN RAISE EXCEPTION 'bank_card_offer_payment_not_verified'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_bank_card_offer_order_payment
  BEFORE UPDATE OF payment_status, payment_method ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.guard_bank_card_offer_order_payment();
REVOKE ALL ON FUNCTION private.guard_bank_card_offer_order_payment() FROM PUBLIC, anon, authenticated, service_role;
