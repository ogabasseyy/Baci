-- Record every confirmed bank-offer terminal outcome before retiring a sweep candidate.
CREATE OR REPLACE FUNCTION public.flag_bank_card_offer_terminal_review(
  p_order_id uuid, p_merchant_id uuid, p_transaction_id uuid, p_status text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_context jsonb;
BEGIN
  IF COALESCE(p_status, '') NOT IN ('failed', 'abandoned', 'cancelled', 'reversed')
  THEN RETURN false; END IF;

  -- Use the same transaction lock as capture approval and completion.
  PERFORM 1 FROM public.transactions
    WHERE id = p_transaction_id AND order_id = p_order_id AND merchant_id = p_merchant_id
      AND auth.uid() IS NULL
      AND auth.jwt()->>'storefront_order_context' = 'route'
      AND auth.jwt()->>'storefront_order_merchant_id' = p_merchant_id::text
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  v_context := public.get_bank_card_offer_verification_context(p_order_id, p_merchant_id, p_transaction_id);
  IF v_context IS NULL THEN RETURN false; END IF;

  INSERT INTO public.reconciliation_review (issue_type, merchant_id, order_id, txn_id, paystack_ref, reason, metadata)
  SELECT 'gateway_payment_wedge_requires_review', p_merchant_id, p_order_id, t.id,
    v_context->>'reference',
    'Paystack reported a terminal status for a bank-offer checkout. Reconcile the original reference.',
    jsonb_build_object('source', 'bank_card_offer_initialization', 'provider_status', p_status)
  FROM private.bank_card_offer_payment_attempts a
  JOIN public.transactions t ON t.id = a.transaction_id
  WHERE a.order_id = p_order_id AND a.transaction_id = p_transaction_id
    AND t.status IN ('pending', 'processing', 'completed')
  ON CONFLICT DO NOTHING;

  -- Never replace a durable reversal with a later, less conclusive status.
  UPDATE public.reconciliation_review r
  SET metadata = r.metadata || jsonb_build_object('provider_status', CASE
    WHEN r.metadata->>'provider_status' = 'reversed' THEN 'reversed' ELSE p_status END)
  WHERE r.issue_type = 'gateway_payment_wedge_requires_review'
    AND r.order_id = p_order_id AND r.merchant_id = p_merchant_id
    AND r.txn_id = p_transaction_id AND r.paystack_ref = v_context->>'reference'
    AND r.metadata->>'source' = 'bank_card_offer_initialization' AND r.resolved_at IS NULL;
  RETURN FOUND OR EXISTS (
    SELECT 1 FROM public.reconciliation_review r
    WHERE r.issue_type = 'gateway_payment_wedge_requires_review'
      AND r.merchant_id = p_merchant_id AND r.order_id = p_order_id
      AND r.txn_id = p_transaction_id AND r.paystack_ref = v_context->>'reference'
      AND r.metadata->>'source' = 'bank_card_offer_initialization'
      AND r.metadata->>'provider_status' = 'reversed'
  );
END;
$$;
