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

  -- Never replace a durable reversal with a later, less conclusive status.
  UPDATE public.reconciliation_review r
  SET metadata = r.metadata || jsonb_build_object('provider_status', CASE
    WHEN r.metadata->>'provider_status' = 'reversed' THEN 'reversed' ELSE p_status END)
  WHERE r.issue_type = 'gateway_payment_wedge_requires_review'
    AND r.order_id = p_order_id AND r.merchant_id = p_merchant_id
    AND r.txn_id = p_transaction_id AND r.paystack_ref = v_context->>'reference'
    AND r.metadata->>'source' IN ('bank_card_offer_initialization', 'bank_card_offer_dispute') AND r.resolved_at IS NULL;
  IF FOUND THEN RETURN true; END IF;

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

  RETURN FOUND OR EXISTS (
    SELECT 1 FROM public.reconciliation_review r
    WHERE r.issue_type = 'gateway_payment_wedge_requires_review'
      AND r.merchant_id = p_merchant_id AND r.order_id = p_order_id
      AND r.txn_id = p_transaction_id AND r.paystack_ref = v_context->>'reference'
      AND r.metadata->>'source' IN ('bank_card_offer_initialization', 'bank_card_offer_dispute')
      AND r.metadata->>'provider_status' = 'reversed'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_paid_bank_card_offer_recheck()
RETURNS TABLE (
  transaction_id uuid, order_id uuid, merchant_id uuid, gateway_reference text
) LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH eligible AS (
    SELECT a.transaction_id, a.order_id, t.merchant_id, t.gateway_reference
    FROM private.bank_card_offer_payment_attempts a
    JOIN public.transactions t ON t.id = a.transaction_id AND t.order_id = a.order_id
    JOIN public.orders o ON o.id = a.order_id AND o.merchant_id = t.merchant_id
    WHERE a.paid_recheck_after <= now() AND a.verified_evidence IS NOT NULL
      AND t.transaction_type = 'payment' AND t.gateway = 'paystack' AND t.status = 'completed'
      AND t.gateway_reference ~ '^BCO-[a-f0-9]{32}$'
      AND o.payment_method = 'bank_card_offer' AND o.payment_status = 'paid'
      AND NOT EXISTS (
        SELECT 1 FROM public.reconciliation_review r
        WHERE r.txn_id = t.id AND r.order_id = o.id AND r.merchant_id = t.merchant_id
          AND r.paystack_ref = t.gateway_reference
          AND r.issue_type = 'gateway_payment_wedge_requires_review'
          AND r.metadata->>'source' IN ('bank_card_offer_initialization', 'bank_card_offer_dispute')
          AND r.metadata->>'provider_status' = 'reversed'
      )
    ORDER BY a.paid_recheck_after, a.transaction_id
    LIMIT 1 FOR UPDATE OF a SKIP LOCKED
  ), claimed AS (
    UPDATE private.bank_card_offer_payment_attempts a
    SET paid_recheck_after = now() + interval '50 minutes'
    FROM eligible e WHERE a.transaction_id = e.transaction_id
    RETURNING e.transaction_id, e.order_id, e.merchant_id, e.gateway_reference
  )
  SELECT c.transaction_id, c.order_id, c.merchant_id, c.gateway_reference FROM claimed c;
$$;

CREATE OR REPLACE FUNCTION private.note_bank_card_offer_reversal_during_refund()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.issue_type = 'gateway_payment_wedge_requires_review'
    AND NEW.metadata->>'source' IN ('bank_card_offer_initialization', 'bank_card_offer_dispute')
    AND NEW.metadata->>'provider_status' = 'reversed'
    AND EXISTS (SELECT 1 FROM private.bank_card_offer_payment_attempts a
      WHERE a.transaction_id = NEW.txn_id AND a.refund_dispatch_claim IS NOT NULL)
  THEN
    NEW.metadata := NEW.metadata || jsonb_build_object('refund_dispatch_admitted', true);
  END IF;
  RETURN NEW;
END;
$$;
