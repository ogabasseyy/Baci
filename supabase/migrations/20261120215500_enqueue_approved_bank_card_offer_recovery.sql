CREATE OR REPLACE FUNCTION public.approve_bank_card_offer_capture(
  p_order_id uuid, p_merchant_id uuid, p_transaction_id uuid,
  p_evidence jsonb, p_gateway_response jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.get_bank_card_offer_verification_context(p_order_id, p_merchant_id, p_transaction_id) IS NULL
    OR jsonb_typeof(p_gateway_response) IS DISTINCT FROM 'object'
    OR p_gateway_response->>'status' IS DISTINCT FROM 'success'
    OR p_gateway_response->>'reference' IS DISTINCT FROM p_evidence->>'reference'
    OR p_gateway_response->>'domain' IS DISTINCT FROM p_evidence->>'domain'
    OR upper(p_gateway_response->>'currency') IS DISTINCT FROM p_evidence->>'currency'
    OR p_gateway_response->>'id' IS DISTINCT FROM p_evidence->>'providerVerificationId'
    OR p_gateway_response->'amount' IS DISTINCT FROM p_evidence->'amountKobo'
  THEN RETURN false; END IF;

  PERFORM 1 FROM public.transactions
    WHERE id = p_transaction_id AND order_id = p_order_id AND merchant_id = p_merchant_id
      AND status IN ('pending', 'processing', 'completed')
    FOR UPDATE;
  IF NOT FOUND OR public.approve_bank_card_offer_capture(
    p_order_id, p_merchant_id, p_transaction_id, p_evidence
  ) IS DISTINCT FROM true THEN RETURN false; END IF;

  -- This flag enrolls an approved capture in the existing wedge sweep
  -- even if the subsequent order-completion RPC fails before commit.
  UPDATE public.transactions
    SET gateway_response = p_gateway_response,
        metadata = CASE
          WHEN status = 'pending'
            AND metadata->>'guest_provider_confirmed' IS DISTINCT FROM 'true'
          THEN COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'guest_provider_confirmed', true, 'guest_provider_confirmed_at', now()
          )
          ELSE metadata
        END
    WHERE id = p_transaction_id AND (
      (status = 'completed' AND gateway_response IS NULL)
      OR (status IN ('pending', 'processing') AND (
        gateway_response IS DISTINCT FROM p_gateway_response
        OR (status = 'pending' AND metadata->>'guest_provider_confirmed' IS DISTINCT FROM 'true')
      ))
    );
  RETURN true;
END;
$$;
