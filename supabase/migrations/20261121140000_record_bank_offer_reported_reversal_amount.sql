-- Keep the existing four-argument entry point for terminal responses without
-- a usable amount. The fifth argument is evidence for reconciliation only.
CREATE FUNCTION public.flag_bank_card_offer_terminal_review(
  p_order_id uuid, p_merchant_id uuid, p_transaction_id uuid, p_status text,
  p_reported_amount_kobo bigint
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_status IS DISTINCT FROM 'reversed' OR p_reported_amount_kobo IS NULL
    OR p_reported_amount_kobo NOT BETWEEN 0 AND 9007199254740991
  THEN RETURN false; END IF;

  -- Reuse the merchant route proof and transaction row lock before updating
  -- the same review. Keep the provider's reported amount separate from the
  -- captured amount and from any amount independently confirmed as reversed.
  IF NOT public.flag_bank_card_offer_terminal_review(
    p_order_id, p_merchant_id, p_transaction_id, p_status
  ) THEN RETURN false; END IF;

  UPDATE public.reconciliation_review r
  SET metadata = r.metadata || jsonb_build_object(
    'paystack_reported_reversal_amount_kobo', p_reported_amount_kobo
  )
  FROM public.transactions t
  WHERE t.id = p_transaction_id AND r.txn_id = t.id
    AND r.merchant_id = p_merchant_id AND r.order_id = p_order_id
    AND r.paystack_ref = t.gateway_reference
    AND r.issue_type = 'gateway_payment_wedge_requires_review'
    AND r.resolved_at IS NULL AND r.metadata->>'provider_status' = 'reversed'
    AND r.metadata->>'source' IN ('bank_card_offer_initialization', 'bank_card_offer_dispute');
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.flag_bank_card_offer_terminal_review(uuid, uuid, uuid, text, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.flag_bank_card_offer_terminal_review(uuid, uuid, uuid, text, bigint)
  TO authenticated;
