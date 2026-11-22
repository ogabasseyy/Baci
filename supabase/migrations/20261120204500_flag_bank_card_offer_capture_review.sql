-- The native buyer endpoint records provider capture mismatches through the
-- same merchant-scoped route context as bank-offer verification.
CREATE FUNCTION public.flag_bank_card_offer_capture_review(
  p_order_id uuid, p_merchant_id uuid, p_transaction_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_context jsonb;
  v_reference text;
BEGIN
  v_context := public.get_bank_card_offer_verification_context(
    p_order_id, p_merchant_id, p_transaction_id
  );
  v_reference := v_context->>'reference';
  IF v_reference IS NULL THEN RETURN false; END IF;

  INSERT INTO public.reconciliation_review (
    issue_type, merchant_id, order_id, txn_id, paystack_ref, reason, metadata
  ) VALUES (
    'payment_match_ambiguous', p_merchant_id, p_order_id, p_transaction_id, v_reference,
    'Paystack verification does not match the saved bank card offer',
    jsonb_build_object('source', 'bank_card_offer_capture')
  )
  ON CONFLICT DO NOTHING;

  RETURN FOUND OR EXISTS (
    SELECT 1 FROM public.reconciliation_review
    WHERE issue_type = 'payment_match_ambiguous'
      AND merchant_id = p_merchant_id AND order_id = p_order_id
      AND txn_id = p_transaction_id AND paystack_ref = v_reference
      AND resolved_at IS NULL
  );
END;
$$;
REVOKE ALL ON FUNCTION public.flag_bank_card_offer_capture_review(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.flag_bank_card_offer_capture_review(uuid, uuid, uuid)
  TO authenticated;
