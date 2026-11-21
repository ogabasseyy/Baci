ALTER TABLE private.bank_card_offer_payment_attempts
  ADD COLUMN refund_dispatch_claim uuid,
  ADD COLUMN dispute_hold_at timestamptz;

-- An admitted HTTP call may have reached Paystack even if the worker
-- loses its response. A later claim must reconcile that call, never replay it.
CREATE FUNCTION public.begin_bank_card_offer_refund_dispatch(
  p_order_id uuid, p_merchant_id uuid, p_transaction_id uuid,
  p_reference text, p_claim_token uuid, p_provider_id text,
  p_provider_domain text, p_amount_kobo bigint
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.transactions
  WHERE id = p_transaction_id AND order_id = p_order_id AND merchant_id = p_merchant_id
    AND gateway_reference = p_reference
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 'blocked'; END IF;

  IF EXISTS (
    SELECT 1 FROM private.bank_card_offer_payment_attempts
    WHERE transaction_id = p_transaction_id AND refund_dispatch_claim IS NOT NULL
  ) THEN RETURN 'already_admitted'; END IF;

  IF NOT public.authorize_bank_card_offer_refund_dispatch(
    p_order_id, p_merchant_id, p_transaction_id, p_reference, p_claim_token,
    p_provider_id, p_provider_domain, p_amount_kobo
  ) THEN RETURN 'blocked'; END IF;

  UPDATE private.bank_card_offer_payment_attempts
  SET refund_dispatch_claim = p_claim_token
  WHERE transaction_id = p_transaction_id;
  RETURN 'dispatch';
END;
$$;
REVOKE ALL ON FUNCTION public.begin_bank_card_offer_refund_dispatch(uuid, uuid, uuid, text, uuid, text, text, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_bank_card_offer_refund_dispatch(uuid, uuid, uuid, text, uuid, text, text, bigint)
  TO service_role;

-- A signed dispute can precede any reversal on Paystack verification.
-- Keep both create and resolve on hold for reconciliation.
CREATE FUNCTION public.record_bank_card_offer_dispute(p_reference text, p_event text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_match jsonb;
  v_id uuid;
  v_dispatch_initiated boolean;
BEGIN
  IF COALESCE(p_event, '') NOT IN ('charge.dispute.create', 'charge.dispute.resolve')
    OR COALESCE(p_reference, '') !~ '^BCO-[a-f0-9]{32}$' THEN RETURN false; END IF;
  v_match := public.get_bank_card_offer_webhook_transaction(p_reference);
  IF v_match IS NULL THEN RETURN false; END IF;
  v_id := (v_match->>'id')::uuid;
  PERFORM 1 FROM public.transactions WHERE id = v_id FOR UPDATE;
  UPDATE private.bank_card_offer_payment_attempts
  SET dispute_hold_at = COALESCE(dispute_hold_at, now())
  WHERE transaction_id = v_id
  RETURNING refund_dispatch_claim IS NOT NULL INTO v_dispatch_initiated;
  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO public.reconciliation_review (issue_type, merchant_id, order_id, txn_id, paystack_ref, reason, metadata)
  VALUES ('gateway_payment_wedge_requires_review', (v_match->>'merchant_id')::uuid,
    (v_match->>'order_id')::uuid, v_id, p_reference,
    'Paystack reported a dispute for a bank-offer checkout. Reconcile with the provider.',
    jsonb_build_object('source', 'bank_card_offer_dispute', 'provider_event', p_event,
      'refund_dispatch_admitted', v_dispatch_initiated))
  ON CONFLICT DO NOTHING;

  -- Another payment review may already own the unique review row.
  UPDATE public.reconciliation_review
  SET metadata = metadata || jsonb_build_object('bank_offer_dispute', true,
    'refund_dispatch_admitted', v_dispatch_initiated)
  WHERE issue_type = 'gateway_payment_wedge_requires_review'
    AND txn_id = v_id AND paystack_ref = p_reference AND resolved_at IS NULL;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_bank_card_offer_dispute(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_bank_card_offer_dispute(text, text) TO service_role;

CREATE OR REPLACE FUNCTION private.bank_card_offer_reversal_recorded(p_transaction_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.bank_card_offer_payment_attempts a
    WHERE a.transaction_id = p_transaction_id AND a.dispute_hold_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.reconciliation_review r
    WHERE r.txn_id = p_transaction_id
      AND r.issue_type = 'gateway_payment_wedge_requires_review'
      AND r.metadata->>'source' = 'bank_card_offer_initialization'
      AND r.metadata->>'provider_status' = 'reversed'
  );
$$;

-- Reversals arriving while a refund is in flight remain durable and
-- explicitly identify the admitted call for operations reconciliation.
CREATE FUNCTION private.note_bank_card_offer_reversal_during_refund()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.issue_type = 'gateway_payment_wedge_requires_review'
    AND NEW.metadata->>'source' = 'bank_card_offer_initialization'
    AND NEW.metadata->>'provider_status' = 'reversed'
    AND EXISTS (SELECT 1 FROM private.bank_card_offer_payment_attempts a
      WHERE a.transaction_id = NEW.txn_id AND a.refund_dispatch_claim IS NOT NULL)
  THEN
    NEW.metadata := NEW.metadata || jsonb_build_object('refund_dispatch_admitted', true);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.note_bank_card_offer_reversal_during_refund()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER note_bank_card_offer_reversal_during_refund
  BEFORE INSERT OR UPDATE OF metadata ON public.reconciliation_review
  FOR EACH ROW EXECUTE FUNCTION private.note_bank_card_offer_reversal_during_refund();
