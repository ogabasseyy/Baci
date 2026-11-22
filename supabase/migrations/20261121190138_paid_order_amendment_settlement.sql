ALTER TABLE private.paid_order_amendment_config
  ADD COLUMN bank_account_id uuid UNIQUE,
  ADD COLUMN bank_evidence_cutover timestamptz,
  ADD CONSTRAINT paid_order_amendment_bank_cutover_pair
    CHECK ((bank_account_id IS NULL) = (bank_evidence_cutover IS NULL));

CREATE TABLE private.paid_order_bank_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  account_id uuid NOT NULL,
  bank_transaction_id text NOT NULL CHECK (length(bank_transaction_id) BETWEEN 1 AND 128),
  direction text NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 9999999999),
  currency text NOT NULL CHECK (currency = 'NGN'),
  occurred_at timestamptz NOT NULL,
  statement_entry text NOT NULL CHECK (length(statement_entry) BETWEEN 1 AND 160),
  related_evidence_id uuid REFERENCES private.paid_order_bank_evidence(id),
  order_id uuid REFERENCES public.orders(id),
  bound_order_id uuid REFERENCES public.orders(id),
  allocation text CHECK (allocation IN ('ordinary', 'top_up', 'unapplied', 'returned', 'cancellation_refund')),
  transaction_id uuid UNIQUE,
  UNIQUE (account_id, bank_transaction_id)
);
CREATE INDEX paid_order_bank_evidence_order_idx ON private.paid_order_bank_evidence(order_id);

CREATE TABLE private.paid_order_amendment_operations (
  amendment_id uuid NOT NULL REFERENCES private.paid_order_amendments(id),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request jsonb NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (amendment_id, idempotency_key)
);

CREATE TABLE private.paid_order_offline_disbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  source_kind text NOT NULL CHECK (source_kind IN ('unapplied', 'cancellation_leg')),
  source_id uuid NOT NULL,
  account_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  actor_id uuid NOT NULL,
  evidence_id uuid UNIQUE REFERENCES private.paid_order_bank_evidence(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_id)
);

ALTER TABLE private.paid_order_bank_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.paid_order_amendment_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.paid_order_offline_disbursements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.paid_order_bank_evidence, private.paid_order_amendment_operations,
  private.paid_order_offline_disbursements FROM PUBLIC, anon, authenticated, service_role;

-- The statement importer supplies verified entries. Staff commands take its
-- evidence ID, so a receipt number or transfer amount alone cannot fund an order.
CREATE FUNCTION public.register_paid_order_bank_evidence(
  p_account_id uuid, p_bank_transaction_id text, p_direction text, p_amount_minor bigint,
  p_occurred_at timestamptz, p_statement_entry text, p_related_evidence_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  config private.paid_order_amendment_config%ROWTYPE;
  entry private.paid_order_bank_evidence%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'bank_evidence_worker_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO config FROM private.paid_order_amendment_config WHERE bank_account_id = p_account_id FOR SHARE;
  IF NOT FOUND OR p_occurred_at IS NULL OR p_occurred_at < config.bank_evidence_cutover
    OR p_occurred_at > clock_timestamp()
    OR p_bank_transaction_id IS NULL OR p_bank_transaction_id <> btrim(p_bank_transaction_id)
    OR p_statement_entry IS NULL OR length(btrim(p_statement_entry)) = 0
    OR EXISTS (
      SELECT 1 FROM public.transactions t WHERE t.merchant_id = config.merchant_id
        AND t.gateway = 'manual' AND t.gateway_reference = p_bank_transaction_id
    ) THEN
    RAISE EXCEPTION 'bank_evidence_requires_reconciliation';
  END IF;
  IF p_order_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || p_order_id,0));
    PERFORM 1 FROM public.orders WHERE id = p_order_id AND merchant_id = config.merchant_id FOR UPDATE;
    IF NOT FOUND OR p_direction <> 'incoming' THEN RAISE EXCEPTION 'bank_evidence_conflict'; END IF;
  END IF;
  IF p_related_evidence_id IS NOT NULL AND (
    p_direction <> 'outgoing' OR NOT EXISTS (
      SELECT 1 FROM private.paid_order_bank_evidence e WHERE e.id = p_related_evidence_id
        AND e.account_id = p_account_id AND e.direction = 'incoming'
    )
  ) THEN RAISE EXCEPTION 'bank_evidence_conflict'; END IF;
  INSERT INTO private.paid_order_bank_evidence(merchant_id,account_id,bank_transaction_id,direction,
    amount_minor,currency,occurred_at,statement_entry,related_evidence_id,bound_order_id)
  VALUES (config.merchant_id,p_account_id,p_bank_transaction_id,p_direction,p_amount_minor,
    'NGN',p_occurred_at,btrim(p_statement_entry),p_related_evidence_id,p_order_id)
  ON CONFLICT (account_id,bank_transaction_id) DO NOTHING;
  SELECT * INTO STRICT entry FROM private.paid_order_bank_evidence
  WHERE account_id = p_account_id AND bank_transaction_id = p_bank_transaction_id;
  IF ROW(entry.direction,entry.amount_minor,entry.occurred_at,entry.statement_entry,entry.related_evidence_id,entry.bound_order_id)
     IS DISTINCT FROM ROW(p_direction,p_amount_minor,p_occurred_at,btrim(p_statement_entry),p_related_evidence_id,p_order_id) THEN
    RAISE EXCEPTION 'bank_evidence_conflict';
  END IF;
  RETURN entry.id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_paid_order_bank_evidence(uuid,text,text,bigint,timestamptz,text,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.register_paid_order_bank_evidence(uuid,text,text,bigint,timestamptz,text,uuid,uuid)
  TO service_role;

-- The existing manual writer and the amendment writer both allocate this same
-- row. Lock it after the order. Cash stays on the ordinary legacy path.
CREATE FUNCTION private.guard_paid_order_bank_allocation()
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
REVOKE ALL ON FUNCTION private.guard_paid_order_bank_allocation() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER paid_order_bank_allocation BEFORE INSERT OR UPDATE OF status, order_id, merchant_id,
  gateway_reference, amount, currency, gateway, transaction_type OR DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION private.guard_paid_order_bank_allocation();

CREATE FUNCTION private.apply_paid_order_top_up(a private.paid_order_amendments, p_evidence_id uuid)
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
  IF a.state <> 'awaiting_payment' OR a.balance_due_minor <> entry.amount_minor
    OR EXISTS (SELECT 1 FROM private.paid_order_bank_evidence
      WHERE order_id = a.order_id AND allocation = 'unapplied') THEN
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

CREATE FUNCTION private.apply_paid_order_disbursement(a private.paid_order_amendments, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  source private.paid_order_bank_evidence%ROWTYPE;
  outgoing private.paid_order_bank_evidence%ROWTYPE;
  claim private.paid_order_offline_disbursements%ROWTYPE;
  kind text := p_payload->>'sourceKind';
  refund_id uuid;
BEGIN
  IF p_payload->>'action' = 'claim_offline_disbursement' THEN
    IF kind NOT IN ('unapplied','cancellation_leg') THEN
      RAISE EXCEPTION 'invalid_amendment_action' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO source FROM private.paid_order_bank_evidence e
    WHERE e.order_id = a.order_id AND e.direction = 'incoming'
      AND ((kind = 'unapplied' AND e.id = (p_payload->>'sourceId')::uuid AND e.allocation = 'unapplied')
        OR (kind = 'cancellation_leg' AND e.transaction_id = (p_payload->>'sourceId')::uuid AND e.allocation = 'top_up'
          AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = a.order_id AND o.cancelled_at IS NOT NULL)))
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'bank_evidence_conflict'; END IF;
    INSERT INTO private.paid_order_offline_disbursements(order_id,source_kind,source_id,account_id,amount_minor,actor_id)
    VALUES (a.order_id,kind,source.id,source.account_id,source.amount_minor,auth.uid())
    ON CONFLICT (source_kind,source_id) DO NOTHING RETURNING * INTO claim;
    IF NOT FOUND THEN RAISE EXCEPTION 'refund_claim_open'; END IF;
    INSERT INTO private.paid_order_amendment_events(amendment_id,actor_id,event_type,details)
    VALUES (a.id,auth.uid(),'offline_disbursement_claimed',jsonb_build_object('claimId',claim.id,'amountMinor',claim.amount_minor));
    RETURN jsonb_build_object('claimId',claim.id,'amountMinor',claim.amount_minor,'currency','NGN');
  END IF;

  SELECT * INTO claim FROM private.paid_order_offline_disbursements
  WHERE id = (p_payload->>'claimId')::uuid AND order_id = a.order_id FOR UPDATE;
  IF NOT FOUND OR claim.evidence_id IS NOT NULL THEN RAISE EXCEPTION 'refund_claim_open'; END IF;
  SELECT * INTO outgoing FROM private.paid_order_bank_evidence WHERE id = (p_payload->>'evidenceId')::uuid
    AND merchant_id = a.merchant_id AND account_id = claim.account_id AND direction = 'outgoing'
    AND amount_minor = claim.amount_minor AND related_evidence_id = claim.source_id FOR UPDATE;
  IF NOT FOUND OR outgoing.allocation IS NOT NULL THEN RAISE EXCEPTION 'bank_evidence_conflict'; END IF;
  SELECT * INTO STRICT source FROM private.paid_order_bank_evidence WHERE id = claim.source_id FOR UPDATE;
  IF claim.source_kind = 'unapplied' THEN
    UPDATE private.paid_order_bank_evidence SET allocation = 'returned' WHERE id = source.id;
  ELSE
    refund_id := gen_random_uuid();
  END IF;
  UPDATE private.paid_order_bank_evidence SET allocation = CASE WHEN refund_id IS NULL THEN 'returned' ELSE 'cancellation_refund' END,
    order_id = a.order_id, transaction_id = refund_id WHERE id = outgoing.id;
  UPDATE private.paid_order_offline_disbursements SET evidence_id = outgoing.id WHERE id = claim.id;
  IF refund_id IS NOT NULL THEN
    INSERT INTO public.transactions(id,merchant_id,order_id,transaction_type,amount,currency,status,gateway,gateway_reference,metadata)
    VALUES (refund_id,a.merchant_id,a.order_id,'refund',claim.amount_minor::numeric/100,'NGN','completed','manual',
      outgoing.id::text,jsonb_build_object('payment_transaction_id',source.transaction_id,'method','bank_transfer'));
  END IF;
  INSERT INTO private.paid_order_amendment_events(amendment_id,actor_id,event_type,details)
  VALUES (a.id,auth.uid(),'offline_disbursement_verified',jsonb_build_object('evidenceId',outgoing.id,'claimId',claim.id,
    'transactionId',refund_id,'amountMinor',claim.amount_minor));
  RETURN jsonb_build_object('claimId',claim.id,'outcome','verified','transactionId',refund_id);
END;
$$;

REVOKE ALL ON FUNCTION private.apply_paid_order_top_up(private.paid_order_amendments,uuid),
  private.apply_paid_order_disbursement(private.paid_order_amendments,jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the stale capture as permanently ineligible for order funding.
-- Only verified provider evidence of a full return closes the recovery fence.
ALTER TABLE private.paid_order_checkout_capture_exceptions
  ADD COLUMN return_provider_id text UNIQUE,
  ADD COLUMN returned_at timestamptz;

CREATE FUNCTION public.record_paid_order_stale_capture_return(p_reference text,p_verified jsonb)
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
  SELECT c.paystack_integration_id::text INTO integration FROM private.paid_order_amendment_config c
    JOIN public.orders o ON o.merchant_id = c.merchant_id WHERE o.id = evidence.order_id;
  SELECT * INTO STRICT evidence FROM private.paid_order_checkout_capture_exceptions WHERE reference = p_reference FOR UPDATE;
  IF integration IS NULL OR COALESCE(evidence.provider_transaction_id,'') !~ '^[1-9][0-9]{0,19}$'
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
REVOKE ALL ON FUNCTION public.record_paid_order_stale_capture_return(text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_paid_order_stale_capture_return(text,jsonb) TO service_role;
