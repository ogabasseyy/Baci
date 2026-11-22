-- Initialization can race the first provider call. Only acknowledge
-- reconciliation after the attempt has an open recovery record.
CREATE FUNCTION public.request_bank_card_offer_initialization_review(
  p_order_id uuid, p_merchant_id uuid, p_reference text, p_failed boolean
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.get_bank_card_offer_checkout_context(p_order_id, p_merchant_id) IS NULL
  THEN RETURN false; END IF;
  PERFORM public.flag_bank_card_offer_initialization_review(
    p_order_id, p_merchant_id, p_reference, p_failed
  );
  RETURN EXISTS (
    SELECT 1
    FROM private.bank_card_offer_payment_attempts a
    JOIN public.reconciliation_review r ON r.txn_id = a.transaction_id
    WHERE a.order_id = p_order_id
      AND r.order_id = p_order_id AND r.merchant_id = p_merchant_id
      AND r.paystack_ref = p_reference AND r.resolved_at IS NULL
      AND r.issue_type = 'gateway_payment_wedge_requires_review'
      AND r.metadata->>'source' = 'bank_card_offer_initialization'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.request_bank_card_offer_initialization_review(uuid, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_bank_card_offer_initialization_review(uuid, uuid, text, boolean)
  TO authenticated;

-- A repeated native poll is successful when a sweep marker is already
-- durable or the transaction has since completed. Do not reset the grace
-- period or authorize settlement from this buyer-owned entry point.
CREATE FUNCTION public.ensure_bank_card_offer_capture_sweep(p_reference text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_transaction record;
BEGIN
  SELECT t.status, COALESCE(t.metadata->>'guest_provider_confirmed', 'false') = 'true' AS confirmed
    INTO v_transaction
  FROM public.transactions t
  JOIN private.bank_card_offer_payment_attempts a ON a.transaction_id = t.id AND a.order_id = t.order_id
  JOIN public.orders o ON o.id = t.order_id AND o.merchant_id = t.merchant_id
  JOIN public.customers c ON c.id = o.customer_id AND c.merchant_id = o.merchant_id
  WHERE t.gateway_reference = p_reference AND t.gateway = 'paystack' AND t.transaction_type = 'payment'
    AND o.payment_method = 'bank_card_offer' AND c.user_id = auth.uid()
  FOR UPDATE OF t;

  IF NOT FOUND THEN RETURN false; END IF;
  IF v_transaction.status = 'completed' THEN RETURN true; END IF;
  IF v_transaction.status <> 'pending' THEN RETURN false; END IF;
  IF v_transaction.confirmed THEN RETURN true; END IF;
  RETURN public.flag_sessionless_payment_provider_confirmed(p_reference);
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_bank_card_offer_capture_sweep(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_bank_card_offer_capture_sweep(text) TO authenticated;
