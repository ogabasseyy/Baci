-- Serialize refund admission with the terminal review writer. The active
-- cancellation-side-effect claim excludes another refund worker.
CREATE FUNCTION public.authorize_bank_card_offer_refund_dispatch(
  p_order_id uuid, p_merchant_id uuid, p_transaction_id uuid,
  p_reference text, p_claim_token uuid, p_provider_id text,
  p_provider_domain text, p_amount_kobo bigint
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.transactions t
    WHERE t.id = p_transaction_id AND t.order_id = p_order_id AND t.merchant_id = p_merchant_id
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  PERFORM 1 FROM public.order_cancellation_side_effects effect
    WHERE effect.order_id = p_order_id AND effect.merchant_id = p_merchant_id
      AND effect.step = 'refund' AND effect.status = 'claimed' AND effect.claim_token = p_claim_token
    FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;

  RETURN COALESCE(public.get_bank_card_offer_refundable_amount(
    p_order_id, p_merchant_id, p_transaction_id, p_reference
  ) = p_amount_kobo, false) AND EXISTS (
    SELECT 1 FROM private.bank_card_offer_payment_attempts a
    WHERE a.order_id = p_order_id AND a.transaction_id = p_transaction_id
      AND a.provider_domain = p_provider_domain
      AND a.verified_evidence->>'providerVerificationId' = p_provider_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.authorize_bank_card_offer_refund_dispatch(uuid, uuid, uuid, text, uuid, text, text, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.authorize_bank_card_offer_refund_dispatch(uuid, uuid, uuid, text, uuid, text, text, bigint)
  TO service_role;
