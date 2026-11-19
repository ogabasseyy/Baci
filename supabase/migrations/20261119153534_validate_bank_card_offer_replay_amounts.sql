-- Keep both replay paths bound to the saved kobo amount.
CREATE OR REPLACE FUNCTION public.get_bank_card_offer_checkout_replay(
  p_merchant_id uuid, p_key text, p_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order record;
BEGIN
  IF auth.uid() IS NULL
    OR auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route'
    OR auth.jwt()->>'storefront_order_merchant_id' IS DISTINCT FROM p_merchant_id::text
    OR COALESCE(p_hash, '') !~ '^[0-9a-f]{64}$'
  THEN RETURN NULL; END IF;

  SELECT o.id, o.order_number, o.tracking_token, o.subtotal, o.shipping_fee, o.discount_amount,
    o.tax_amount, o.total, o.customer_id, o.customer_email, o.customer_name, o.customer_phone,
    o.payment_status, o.shipping_status, o.payment_method, o.shipping_address, o.merchant_id,
    o.tax_basis, o.gift_wrapping_fee, o.checkout_request_hash, true AS idempotency_replayed,
    o.currency AS replay_currency, s.payable_kobo AS replay_payable_kobo
  INTO v_order
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id AND c.merchant_id = o.merchant_id
  JOIN private.bank_card_offer_order_snapshots s ON s.order_id = o.id AND s.merchant_id = o.merchant_id
  WHERE o.merchant_id = p_merchant_id AND o.checkout_idempotency_key = p_key
    AND o.payment_method = 'bank_card_offer' AND c.user_id = auth.uid();

  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_order.checkout_request_hash IS DISTINCT FROM p_hash THEN
    RAISE EXCEPTION 'checkout_idempotency_conflict';
  END IF;
  IF v_order.replay_currency IS DISTINCT FROM 'NGN'
    OR v_order.total * 100 IS DISTINCT FROM v_order.replay_payable_kobo
  THEN
    RAISE EXCEPTION 'bank_card_offer_checkout_mismatch';
  END IF;
  RETURN to_jsonb(v_order) - ARRAY['checkout_request_hash', 'replay_currency', 'replay_payable_kobo'];
END;
$$;

CREATE OR REPLACE FUNCTION public.get_bank_card_offer_verification_context(
  p_order_id uuid, p_merchant_id uuid, p_transaction_id uuid
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('quote', ctx.quote, 'amountKobo', ctx.amount_kobo,
    'customerEmail', ctx.customer_email, 'reference', ctx.reference,
    'acceptedFilterPolicyHash', a.policy_hash, 'domain', a.provider_domain,
    'completedGatewayResponse', CASE WHEN t.status = 'completed'
      AND jsonb_typeof(t.gateway_response) = 'object'
      AND t.gateway_response->>'reference' = ctx.reference
      AND t.gateway_response->>'status' = 'success'
      AND t.gateway_response->'amount' = to_jsonb(ctx.amount_kobo)
      AND t.gateway_response->>'domain' = a.provider_domain
      AND t.gateway_response->>'id' = a.verified_evidence->>'providerVerificationId'
      AND a.verified_evidence->>'reference' = ctx.reference
      AND a.verified_evidence->>'acceptedFilterPolicyHash' = a.policy_hash
      AND a.verified_evidence->>'domain' = a.provider_domain
      AND a.verified_evidence->'amountKobo' = to_jsonb(ctx.amount_kobo)
      THEN t.gateway_response ELSE NULL END)
  FROM private.bank_card_offer_payment_attempts a
  JOIN public.transactions t ON t.id = a.transaction_id
  CROSS JOIN LATERAL private.read_bank_card_offer_payment_context(p_order_id, p_merchant_id, p_transaction_id) ctx
  WHERE a.order_id = p_order_id AND a.transaction_id = p_transaction_id
    AND auth.uid() IS NULL
    AND auth.jwt()->>'storefront_order_context' = 'route'
    AND auth.jwt()->>'storefront_order_merchant_id' = p_merchant_id::text;
$$;
