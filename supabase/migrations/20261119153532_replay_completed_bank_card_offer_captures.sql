-- A completed, previously approved bank-offer capture can replay during
-- provider downtime. Pending attempts must still verify directly with Paystack.
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
      AND t.gateway_response->>'amount' = ctx.amount_kobo::text
      AND t.gateway_response->>'domain' = a.provider_domain
      AND t.gateway_response->>'id' = a.verified_evidence->>'providerVerificationId'
      AND a.verified_evidence->>'reference' = ctx.reference
      AND a.verified_evidence->>'acceptedFilterPolicyHash' = a.policy_hash
      AND a.verified_evidence->>'domain' = a.provider_domain
      AND a.verified_evidence->>'amountKobo' = ctx.amount_kobo::text
      THEN t.gateway_response ELSE NULL END)
  FROM private.bank_card_offer_payment_attempts a
  JOIN public.transactions t ON t.id = a.transaction_id
  CROSS JOIN LATERAL private.read_bank_card_offer_payment_context(p_order_id, p_merchant_id, p_transaction_id) ctx
  WHERE a.order_id = p_order_id AND a.transaction_id = p_transaction_id
    AND auth.uid() IS NULL
    AND auth.jwt()->>'storefront_order_context' = 'route'
    AND auth.jwt()->>'storefront_order_merchant_id' = p_merchant_id::text;
$$;
