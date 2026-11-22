CREATE OR REPLACE FUNCTION public.record_bank_card_offer_dispute(
  p_reference text, p_event text, p_dispute_id text, p_outcome text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_match jsonb;
  v_id uuid;
  v_held boolean;
  v_dispatch_admitted boolean;
  v_outcome text;
BEGIN
  IF COALESCE(p_event, '') NOT IN ('charge.dispute.create', 'charge.dispute.resolve')
    OR COALESCE(p_reference, '') !~ '^BCO-[a-f0-9]{32}$'
    OR COALESCE(p_dispute_id, '') !~ '^[0-9]{1,32}$'
    OR COALESCE(p_outcome, '') NOT IN ('open', 'won', 'lost')
    OR (p_event = 'charge.dispute.create' AND p_outcome <> 'open')
  THEN RETURN false; END IF;
  v_match := public.get_bank_card_offer_webhook_transaction(p_reference);
  IF v_match IS NULL THEN RETURN false; END IF;
  v_id := (v_match->>'id')::uuid;

  -- Serialize provider outcomes with refund admission. Replayed creates
  -- cannot reopen a won dispute, and a conflicting loss fails closed.
  PERFORM 1 FROM public.transactions WHERE id = v_id FOR UPDATE;
  INSERT INTO private.bank_card_offer_disputes AS d (transaction_id, provider_dispute_id, outcome)
    VALUES (v_id, p_dispute_id, p_outcome)
    ON CONFLICT (transaction_id, provider_dispute_id) DO UPDATE
    SET outcome = CASE
      WHEN d.outcome = 'lost' OR EXCLUDED.outcome = 'lost' THEN 'lost'
      WHEN d.outcome = 'won' OR EXCLUDED.outcome = 'won' THEN 'won'
      ELSE 'open' END
    RETURNING outcome INTO v_outcome;
  SELECT EXISTS (SELECT 1 FROM private.bank_card_offer_disputes
    WHERE transaction_id = v_id AND outcome <> 'won') INTO v_held;
  UPDATE private.bank_card_offer_payment_attempts
  SET dispute_hold_at = CASE WHEN v_held THEN COALESCE(dispute_hold_at, now()) END
  WHERE transaction_id = v_id
  RETURNING refund_dispatch_claim IS NOT NULL INTO v_dispatch_admitted;
  IF NOT FOUND THEN RAISE EXCEPTION 'bank_card_offer_dispute_attempt_missing'; END IF;

  IF v_held AND NOT EXISTS (
    SELECT 1 FROM public.reconciliation_review
    WHERE issue_type = 'gateway_payment_wedge_requires_review'
      AND txn_id = v_id AND paystack_ref = p_reference AND resolved_at IS NULL
  ) THEN
    INSERT INTO public.reconciliation_review (issue_type, merchant_id, order_id, txn_id, paystack_ref, reason, metadata)
    VALUES ('gateway_payment_wedge_requires_review', (v_match->>'merchant_id')::uuid,
      (v_match->>'order_id')::uuid, v_id, p_reference,
      'Paystack reported a dispute for a bank-offer checkout. Reconcile with the provider.',
      jsonb_build_object('source', 'bank_card_offer_dispute'))
    ON CONFLICT DO NOTHING;
  END IF;
  UPDATE public.reconciliation_review
  SET metadata = metadata || jsonb_build_object(
      'bank_offer_dispute', true, 'bank_offer_dispute_hold', v_held,
      'provider_dispute_id', p_dispute_id, 'provider_dispute_outcome', v_outcome,
      'refund_dispatch_admitted', v_dispatch_admitted
    ),
    resolved_at = CASE
      WHEN NOT v_held AND NOT v_dispatch_admitted
        AND metadata->>'source' = 'bank_card_offer_dispute'
        AND metadata->>'provider_status' IS NULL
      THEN now() ELSE resolved_at END
  WHERE issue_type = 'gateway_payment_wedge_requires_review'
    AND txn_id = v_id AND paystack_ref = p_reference AND resolved_at IS NULL;
  RETURN true;
END;
$$;
