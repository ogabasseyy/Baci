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
    AND ((a.verified_evidence IS NULL AND t.status = 'pending')
      OR (p_status = 'reversed' AND t.status IN ('pending', 'processing', 'completed')))
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

CREATE FUNCTION private.bank_card_offer_reversal_recorded(p_transaction_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reconciliation_review r
    WHERE r.txn_id = p_transaction_id
      AND r.issue_type = 'gateway_payment_wedge_requires_review'
      AND r.metadata->>'source' = 'bank_card_offer_initialization'
      AND r.metadata->>'provider_status' = 'reversed'
  );
$$;
REVOKE ALL ON FUNCTION private.bank_card_offer_reversal_recorded(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.guard_reversed_bank_card_offer_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.transaction_type = 'payment' AND NEW.status = 'completed'
    AND OLD.status IS DISTINCT FROM 'completed'
    AND NEW.gateway_reference LIKE 'BCO-%'
    AND private.bank_card_offer_reversal_recorded(NEW.id)
  THEN RAISE EXCEPTION 'bank_card_offer_payment_reversed'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_reversed_bank_card_offer_completion
  BEFORE UPDATE OF status ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION private.guard_reversed_bank_card_offer_completion();
REVOKE ALL ON FUNCTION private.guard_reversed_bank_card_offer_completion()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.bank_card_offer_refund_capture_matches(
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
      AND NOT private.bank_card_offer_reversal_recorded(t.id)
  );
$$;
