CREATE OR REPLACE FUNCTION private.guard_paid_order_bank_allocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  entry private.paid_order_bank_evidence%ROWTYPE;
  account uuid;
  method text;
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (
    SELECT 1 FROM private.paid_order_bank_evidence WHERE transaction_id = OLD.id
  ) THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'bank_evidence_conflict'; END IF;
    IF ROW(NEW.id,NEW.order_id,NEW.merchant_id,NEW.gateway_reference,NEW.amount,NEW.currency,NEW.gateway,NEW.transaction_type)
       IS DISTINCT FROM ROW(OLD.id,OLD.order_id,OLD.merchant_id,OLD.gateway_reference,OLD.amount,OLD.currency,OLD.gateway,OLD.transaction_type)
       OR (OLD.transaction_type = 'refund' AND ROW(NEW.metadata->>'payment_transaction_id',NEW.metadata->>'method')
         IS DISTINCT FROM ROW(OLD.metadata->>'payment_transaction_id',OLD.metadata->>'method'))
       OR (NEW.status IS DISTINCT FROM OLD.status AND NOT (
         OLD.transaction_type = 'payment' AND OLD.status IN ('completed','refund_pending')
         AND NEW.status IN ('refund_pending','refunded')
       )) THEN
      RAISE EXCEPTION 'bank_evidence_conflict';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.order_id IS NULL OR NEW.gateway IS DISTINCT FROM 'manual' THEN RETURN NEW; END IF;
  IF NEW.transaction_type = 'refund' THEN
    IF EXISTS (SELECT 1 FROM private.paid_order_bank_evidence
      WHERE transaction_id::text = NEW.metadata->>'payment_transaction_id' AND allocation = 'top_up')
      AND NOT EXISTS (SELECT 1 FROM private.paid_order_bank_evidence
        WHERE transaction_id = NEW.id AND allocation = 'cancellation_refund' AND order_id = NEW.order_id) THEN
      RAISE EXCEPTION 'bank_disbursement_evidence_required';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.transaction_type <> 'payment' OR NEW.status <> 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND ROW(NEW.id,NEW.order_id,NEW.merchant_id,NEW.gateway,NEW.gateway_reference,
      NEW.transaction_type,NEW.status,NEW.amount,NEW.currency,NEW.metadata->>'payment_method')
    IS NOT DISTINCT FROM ROW(OLD.id,OLD.order_id,OLD.merchant_id,OLD.gateway,OLD.gateway_reference,
      OLD.transaction_type,OLD.status,OLD.amount,OLD.currency,OLD.metadata->>'payment_method') THEN RETURN NEW; END IF;
  SELECT bank_account_id INTO account FROM private.paid_order_amendment_config WHERE merchant_id = NEW.merchant_id;
  IF account IS NULL THEN RETURN NEW; END IF;
  method := lower(COALESCE(NEW.metadata->>'payment_method',''));
  IF method IN ('cash','pos') AND NOT EXISTS (
    SELECT 1 FROM private.paid_order_amendments WHERE order_id = NEW.order_id
  ) THEN RETURN NEW; END IF;
  IF COALESCE(NEW.gateway_reference,'') !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'bank_evidence_required';
  END IF;
  PERFORM 1 FROM public.orders WHERE id = NEW.order_id FOR UPDATE;
  SELECT * INTO entry FROM private.paid_order_bank_evidence
  WHERE id = NEW.gateway_reference::uuid AND merchant_id = NEW.merchant_id AND account_id = account
    AND (bound_order_id IS NULL OR bound_order_id = NEW.order_id)
    AND direction = 'incoming' AND currency = NEW.currency AND amount_minor = NEW.amount * 100 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank_evidence_required'; END IF;
  IF entry.allocation = 'top_up' AND entry.order_id = NEW.order_id AND entry.transaction_id = NEW.id THEN
    RETURN NEW;
  END IF;
  IF entry.allocation IS NOT NULL OR EXISTS (
    SELECT 1 FROM private.paid_order_amendments WHERE order_id = NEW.order_id
  ) THEN RAISE EXCEPTION 'bank_evidence_conflict'; END IF;
  UPDATE private.paid_order_bank_evidence SET allocation = 'ordinary', order_id = NEW.order_id,
    transaction_id = NEW.id WHERE id = entry.id;
  RETURN NEW;
END;
$$;

-- Linkage changes through metadata must use the same evidence guard.
DROP TRIGGER paid_order_bank_allocation ON public.transactions;
CREATE TRIGGER paid_order_bank_allocation BEFORE INSERT OR UPDATE OF status, order_id, merchant_id,
  gateway_reference, amount, currency, gateway, transaction_type, metadata OR DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION private.guard_paid_order_bank_allocation();

CREATE OR REPLACE FUNCTION private.apply_paid_order_top_up(a private.paid_order_amendments, p_evidence_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  entry private.paid_order_bank_evidence%ROWTYPE;
  payment_id uuid := gen_random_uuid();
BEGIN
  SELECT e.* INTO entry FROM private.paid_order_bank_evidence e
  JOIN private.paid_order_amendment_config c ON c.merchant_id = e.merchant_id AND c.bank_account_id = e.account_id
  WHERE e.id = p_evidence_id AND e.merchant_id = a.merchant_id AND e.direction = 'incoming'
    AND (e.bound_order_id IS NULL OR e.bound_order_id = a.order_id) FOR UPDATE OF e;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank_evidence_required'; END IF;
  IF entry.allocation IS NOT NULL THEN RAISE EXCEPTION 'bank_evidence_conflict'; END IF;
  IF a.state = 'awaiting_payment' AND a.balance_due_minor = entry.amount_minor AND (
    EXISTS (SELECT 1 FROM private.paid_order_bank_evidence e WHERE e.id <> entry.id AND (
      (e.order_id = a.order_id AND e.allocation = 'unapplied')
      OR (e.bound_order_id = a.order_id AND e.allocation IS NULL AND e.amount_minor <> a.balance_due_minor)
    ))
    OR EXISTS (SELECT 1 FROM private.paid_order_checkout_capture_exceptions
      WHERE order_id = a.order_id AND returned_at IS NULL)
  ) THEN RAISE EXCEPTION 'amendment_payment_open'; END IF;
  IF a.state <> 'awaiting_payment' OR a.balance_due_minor <> entry.amount_minor THEN
    UPDATE private.paid_order_bank_evidence SET order_id = a.order_id, allocation = 'unapplied' WHERE id = entry.id;
    INSERT INTO private.paid_order_amendment_events(amendment_id,actor_id,event_type,details)
    VALUES (a.id,auth.uid(),'bank_funds_unapplied',jsonb_build_object('evidenceId',entry.id,'amountMinor',entry.amount_minor));
    RETURN jsonb_build_object('outcome','unapplied','evidenceId',entry.id);
  END IF;

  UPDATE private.paid_order_bank_evidence SET order_id = a.order_id, allocation = 'top_up',
    transaction_id = payment_id WHERE id = entry.id;
  INSERT INTO public.transactions(id,merchant_id,order_id,transaction_type,amount,currency,status,gateway,gateway_reference,metadata)
  VALUES (payment_id,a.merchant_id,a.order_id,'payment',entry.amount_minor::numeric/100,'NGN','completed',
    'manual',entry.id::text,jsonb_build_object('payment_method','bank_transfer','paid_order_amendment_id',a.id));
  UPDATE private.paid_order_amendments SET state = 'settled', balance_due_minor = 0, hold_fulfillment = false WHERE id = a.id;
  UPDATE public.orders SET amount_paid = amount_paid + entry.amount_minor::numeric/100, payment_status = 'paid'
  WHERE id = a.order_id;
  INSERT INTO private.paid_order_amendment_events(amendment_id,actor_id,event_type,details)
  VALUES (a.id,auth.uid(),'top_up_recorded',jsonb_build_object('evidenceId',entry.id,'transactionId',payment_id,
    'amountMinor',entry.amount_minor));
  RETURN private.paid_order_amendment_summary(a.order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_paid_order_stale_capture_return(p_reference text,p_verified jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  evidence private.paid_order_checkout_capture_exceptions%ROWTYPE;
  integration text;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'refund_evidence_worker_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO evidence FROM private.paid_order_checkout_capture_exceptions WHERE reference = p_reference;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || evidence.order_id,0));
  SELECT COALESCE(b.provider_integration_id::text,
      CASE WHEN evidence.outcome = 'unapplied' THEN evidence.provider_integration_id END,
      c.paystack_integration_id::text)
    INTO integration FROM public.orders o
    LEFT JOIN private.paid_order_amendment_config c ON o.merchant_id = c.merchant_id
    LEFT JOIN private.paid_order_checkout_capture_bindings b ON b.reference = p_reference AND b.order_id = o.id
    WHERE o.id = evidence.order_id;
  SELECT * INTO STRICT evidence FROM private.paid_order_checkout_capture_exceptions WHERE reference = p_reference FOR UPDATE;
  IF COALESCE(integration,'') !~ '^[1-9][0-9]{0,19}$' OR COALESCE(evidence.provider_transaction_id,'') !~ '^[1-9][0-9]{0,19}$'
    OR COALESCE(evidence.amount_minor,'') !~ '^[1-9][0-9]{0,14}$'
    OR COALESCE(evidence.currency,'') <> 'NGN'
    OR (evidence.provider_integration_id IS NOT NULL AND evidence.provider_integration_id <> integration)
    OR p_verified->>'integration' IS DISTINCT FROM integration
    OR p_verified->>'transactionId' IS DISTINCT FROM evidence.provider_transaction_id
    OR p_verified->>'amount' IS DISTINCT FROM evidence.amount_minor
    OR p_verified->>'currency' IS DISTINCT FROM evidence.currency
    OR p_verified->>'status' IS DISTINCT FROM 'processed'
    OR COALESCE(p_verified->>'id','') !~ '^[1-9][0-9]{0,19}$'
    OR (evidence.returned_at IS NOT NULL AND evidence.return_provider_id IS DISTINCT FROM p_verified->>'id') THEN
    RAISE EXCEPTION 'refund_evidence_required';
  END IF;
  UPDATE private.paid_order_checkout_capture_exceptions
    SET returned_at = clock_timestamp(),return_provider_id = p_verified->>'id'
    WHERE reference = p_reference AND returned_at IS NULL;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_paid_order_amendment_adjustment(
  p_attempt uuid,p_merchant_debit_minor bigint,p_finance_reference text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  approval private.paid_order_amendment_finance_approvals%ROWTYPE;
  order_id uuid;
  refund_amount bigint;
  available_net numeric;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amendment_finance_worker_required' USING ERRCODE = '42501';
  END IF;
  SELECT a.order_id,r.amount_minor INTO order_id,refund_amount
  FROM private.paid_order_amendment_refunds r JOIN private.paid_order_amendments a ON a.id = r.amendment_id
  WHERE r.id = p_attempt AND r.state = 'processed' AND r.refund_transaction_id IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_evidence_required'; END IF;
  IF p_merchant_debit_minor IS NULL OR p_merchant_debit_minor NOT BETWEEN 0 AND refund_amount
    OR p_finance_reference IS NULL OR length(btrim(p_finance_reference)) NOT BETWEEN 8 AND 160 THEN
    RAISE EXCEPTION 'invalid_amendment_adjustment' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || order_id,0));
  SELECT * INTO approval FROM private.paid_order_amendment_finance_approvals WHERE refund_id = p_attempt;
  IF NOT FOUND THEN
    -- Check the contractual cap before consuming the one approval. A
    -- transient wallet shortage can still retain a valid approval for retry.
    PERFORM 1 FROM public.orders o WHERE o.id = order_id FOR UPDATE;
    SELECT s.net_amount INTO available_net
    FROM private.paid_order_amendment_refunds r
    JOIN private.paid_order_amendments a ON a.id = r.amendment_id
    JOIN public.merchant_settlements s ON s.merchant_id = a.merchant_id
      AND s.source_type = 'order' AND s.source_id = a.order_id
      AND s.gateway = 'paystack' AND s.gateway_reference = r.capture_reference
      AND s.metadata->>'paystack_collection' = 'integration'
    WHERE r.id = p_attempt FOR UPDATE OF s;
    IF available_net IS NULL THEN
      RETURN jsonb_build_object('outcome','review','holdFulfillment',true);
    END IF;
    IF p_merchant_debit_minor::numeric > available_net * 100 THEN
      RAISE EXCEPTION 'invalid_amendment_adjustment' USING ERRCODE = '22023';
    END IF;
    INSERT INTO private.paid_order_amendment_finance_approvals(refund_id,amount_minor,finance_reference)
    VALUES (p_attempt,p_merchant_debit_minor,btrim(p_finance_reference)) RETURNING * INTO approval;
  END IF;
  IF approval.amount_minor IS DISTINCT FROM p_merchant_debit_minor
    OR approval.finance_reference IS DISTINCT FROM btrim(p_finance_reference) THEN
    RAISE EXCEPTION 'idempotency_conflict';
  END IF;
  BEGIN
    RETURN private.post_paid_order_amendment_adjustment(p_attempt,approval.amount_minor,approval.finance_reference);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'merchant_adjustment_review' THEN RAISE; END IF;
    UPDATE private.paid_order_amendment_finance_approvals
      SET next_attempt_at = clock_timestamp() + interval '15 minutes' WHERE refund_id = p_attempt;
    RETURN jsonb_build_object('outcome','review','holdFulfillment',true);
  END;
END;
$$;
