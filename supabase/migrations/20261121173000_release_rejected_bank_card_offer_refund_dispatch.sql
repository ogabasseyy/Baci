-- A definite transient rejection permits another attempt. A lost or
-- ambiguous response must keep the original dispatch fence in place.
CREATE FUNCTION public.release_rejected_bank_card_offer_refund_dispatch(
  p_order_id uuid, p_merchant_id uuid, p_transaction_id uuid,
  p_reference text, p_claim_token uuid, p_rejection_code text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(p_rejection_code, '') NOT IN (
    'HTTP_401', 'HTTP_403', 'HTTP_429', 'CONFIG_ERROR'
  ) THEN
    RETURN false;
  END IF;

  -- Use the same transaction lock as dispatch admission and dispute holds.
  PERFORM 1 FROM public.transactions
    WHERE id = p_transaction_id AND order_id = p_order_id
      AND merchant_id = p_merchant_id AND gateway_reference = p_reference
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE private.bank_card_offer_payment_attempts
    SET refund_dispatch_claim = NULL
    WHERE order_id = p_order_id AND transaction_id = p_transaction_id
      AND refund_dispatch_claim = p_claim_token;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.release_rejected_bank_card_offer_refund_dispatch(uuid, uuid, uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_rejected_bank_card_offer_refund_dispatch(uuid, uuid, uuid, text, uuid, text)
  TO service_role;
