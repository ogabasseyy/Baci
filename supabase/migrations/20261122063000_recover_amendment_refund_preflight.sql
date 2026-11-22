-- A refund blocked before POST must recheck the capture history. A refund
-- already sent remains bound to its exact reference until verified.
ALTER TABLE private.paid_order_amendment_refunds
  ADD COLUMN preflight_review boolean NOT NULL DEFAULT false,
  ADD COLUMN preflight_conflicts text[],
  ADD CONSTRAINT paid_order_amendment_refund_preflight_state
    CHECK (NOT preflight_review OR (state = 'needs_attention' AND provider_refund_id IS NULL));

UPDATE private.paid_order_amendment_refunds r SET preflight_review = true
WHERE r.state = 'needs_attention' AND r.provider_refund_id IS NULL
  AND EXISTS (
    SELECT 1 FROM private.paid_order_amendment_events e
    WHERE e.amendment_id = r.amendment_id AND e.details->>'operationId' = r.id::text
      AND e.event_type = 'refund_evidence_review'
  ) AND NOT EXISTS (
    SELECT 1 FROM private.paid_order_amendment_events e
    WHERE e.amendment_id = r.amendment_id AND e.details->>'operationId' = r.id::text
      AND e.event_type = 'refund_submission_claimed'
  );

CREATE OR REPLACE FUNCTION public.claim_paid_order_amendment_refund(p_attempt uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a private.paid_order_amendments%ROWTYPE;
  r private.paid_order_amendment_refunds%ROWTYPE;
  config private.paid_order_amendment_config%ROWTYPE;
  submit boolean;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amendment_refund_worker_required' USING ERRCODE = '42501';
  END IF;
  SELECT a0.* INTO a FROM private.paid_order_amendments a0
    JOIN private.paid_order_amendment_refunds r0 ON r0.amendment_id = a0.id WHERE r0.id = p_attempt;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO config FROM private.paid_order_amendment_config WHERE merchant_id = a.merchant_id FOR SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || a.order_id,0));
  PERFORM 1 FROM public.orders WHERE id = a.order_id FOR UPDATE;
  SELECT * INTO a FROM private.paid_order_amendments WHERE id = a.id;
  SELECT * INTO r FROM private.paid_order_amendment_refunds WHERE id = p_attempt FOR UPDATE;
  IF a.state <> 'awaiting_refund' OR r.state IN ('failed','processed','void')
    OR r.next_lookup_at > clock_timestamp() THEN RETURN NULL; END IF;
  submit := r.state = 'queued';
  IF submit AND (NOT COALESCE(config.automated_paystack_refunds,false)
    OR config.paystack_integration_id IS DISTINCT FROM r.integration_id) THEN RETURN NULL; END IF;
  UPDATE private.paid_order_amendment_refunds
  SET next_lookup_at = clock_timestamp() + interval '5 minutes' WHERE id = r.id;
  RETURN jsonb_build_object('submit',submit,'preflightReview',r.preflight_review,'reference',r.reference,'captureReference',r.capture_reference,
    'captureId',r.capture_id,'amountMinor',r.amount_minor,'integrationId',r.integration_id::text,'domain',r.domain);
END;
$$;

-- The worker calls this after checking the provider account and history,
-- immediately before POST. Recovery can void a queued attempt before then.
CREATE FUNCTION public.authorize_paid_order_amendment_refund_dispatch(p_attempt uuid,p_clear boolean,p_open_ids text[])
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a private.paid_order_amendments%ROWTYPE;
  r private.paid_order_amendment_refunds%ROWTYPE;
  config private.paid_order_amendment_config%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amendment_refund_worker_required' USING ERRCODE = '42501';
  END IF;
  SELECT a0.* INTO a FROM private.paid_order_amendments a0
    JOIN private.paid_order_amendment_refunds r0 ON r0.amendment_id = a0.id WHERE r0.id = p_attempt;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO config FROM private.paid_order_amendment_config WHERE merchant_id = a.merchant_id FOR SHARE;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || a.order_id,0));
  PERFORM 1 FROM public.orders WHERE id = a.order_id FOR UPDATE;
  SELECT * INTO a FROM private.paid_order_amendments WHERE id = a.id;
  SELECT * INTO r FROM private.paid_order_amendment_refunds WHERE id = p_attempt FOR UPDATE;
  IF p_open_ids IS NOT NULL AND (
    cardinality(p_open_ids) > 2000
    OR EXISTS (SELECT 1 FROM unnest(p_open_ids) AS id WHERE id IS NULL OR id !~ '^[1-9][0-9]{0,19}$')
    OR p_clear IS DISTINCT FROM (cardinality(p_open_ids) = 0)
  ) THEN RETURN false; END IF;
  IF p_clear IS NULL OR a.state <> 'awaiting_refund' OR r.state <> 'queued'
    OR NOT COALESCE(config.automated_paystack_refunds,false)
    OR config.paystack_integration_id IS DISTINCT FROM r.integration_id THEN RETURN false; END IF;
  -- An empty verified history still distinguishes a conflict in the local ledger.
  IF p_clear AND p_open_ids IS NULL THEN p_open_ids := ARRAY[]::text[]; END IF;
  IF EXISTS (SELECT 1 FROM public.transactions WHERE order_id = a.order_id AND transaction_type = 'refund'
      AND status NOT IN ('failed','cancelled')) THEN p_clear := false; END IF;
  UPDATE private.paid_order_amendment_refunds
    SET state = CASE WHEN p_clear THEN 'uncertain' ELSE 'needs_attention' END,
      preflight_review = NOT p_clear,
      preflight_conflicts = CASE WHEN NOT p_clear THEN p_open_ids END,
      next_lookup_at = clock_timestamp() + interval '5 minutes'
    WHERE id = r.id;
  INSERT INTO private.paid_order_amendment_events(amendment_id,event_type,details)
    VALUES (a.id,CASE WHEN p_clear THEN 'refund_submission_claimed' ELSE 'refund_evidence_review' END,
      jsonb_build_object('operationId',r.id,'amountMinor',r.amount_minor));
  RETURN p_clear;
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_paid_order_amendment_refund_dispatch(uuid,boolean,text[])
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.authorize_paid_order_amendment_refund_dispatch(uuid,boolean,text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.authorize_paid_order_amendment_refund_dispatch(p_attempt uuid,p_clear boolean)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.authorize_paid_order_amendment_refund_dispatch(p_attempt,p_clear,NULL::text[]);
$$;

-- Clears a read-only review. The next normal claim must recheck the
-- provider and the dispatch switch before it can send anything.
CREATE FUNCTION public.resolve_paid_order_amendment_refund_preflight(p_attempt uuid,p_failed_ids text[],p_open_ids text[])
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a private.paid_order_amendments%ROWTYPE;
  r private.paid_order_amendment_refunds%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amendment_refund_worker_required' USING ERRCODE = '42501';
  END IF;
  IF p_failed_ids IS NULL OR p_open_ids IS NULL OR cardinality(p_open_ids) + cardinality(p_failed_ids) > 2000
    OR EXISTS (SELECT 1 FROM unnest(p_open_ids || p_failed_ids) AS id WHERE id IS NULL OR id !~ '^[1-9][0-9]{0,19}$')
    THEN RETURN false; END IF;
  SELECT a0.* INTO a FROM private.paid_order_amendments a0
    JOIN private.paid_order_amendment_refunds r0 ON r0.amendment_id = a0.id WHERE r0.id = p_attempt;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || a.order_id,0));
  PERFORM 1 FROM public.orders WHERE id = a.order_id FOR UPDATE;
  SELECT * INTO a FROM private.paid_order_amendments WHERE id = a.id;
  SELECT * INTO r FROM private.paid_order_amendment_refunds WHERE id = p_attempt FOR UPDATE;
  IF a.state <> 'awaiting_refund' OR NOT r.preflight_review THEN RETURN false; END IF;
  IF cardinality(p_open_ids) > 0 THEN
    IF r.preflight_conflicts IS NOT NULL THEN
      UPDATE private.paid_order_amendment_refunds
        SET preflight_conflicts = ARRAY(SELECT DISTINCT id FROM unnest(r.preflight_conflicts || p_open_ids) AS id ORDER BY id)
        WHERE id = r.id;
    END IF;
    RETURN false;
  END IF;
  -- An empty or incomplete provider response cannot retire an observed conflict.
  -- Legacy review rows with unknown provider identities stay held for Finance.
  IF r.preflight_conflicts IS NULL OR NOT (r.preflight_conflicts <@ p_failed_ids) OR EXISTS (
    SELECT 1 FROM public.transactions WHERE order_id = a.order_id AND transaction_type = 'refund'
      AND status NOT IN ('failed','cancelled')
  ) THEN RETURN false; END IF;
  UPDATE private.paid_order_amendment_refunds
    SET state = 'queued',preflight_review = false,preflight_conflicts = NULL,next_lookup_at = clock_timestamp()
    WHERE id = r.id;
  INSERT INTO private.paid_order_amendment_events(amendment_id,event_type,details)
    VALUES (a.id,'refund_preflight_cleared',jsonb_build_object('operationId',r.id));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_paid_order_amendment_refund_preflight(uuid,text[],text[])
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.resolve_paid_order_amendment_refund_preflight(uuid,text[],text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.find_paid_order_amendment_refund(p_reference text, p_provider_id text, p_capture_reference text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  match_reference text;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amendment_refund_worker_required' USING ERRCODE = '42501';
  END IF;
  SELECT reference INTO match_reference FROM private.paid_order_amendment_refunds
  WHERE lower(reference) = lower(p_reference);
  IF FOUND THEN RETURN match_reference; END IF;
  SELECT CASE WHEN count(*) = 1 THEN min(reference) END INTO match_reference
  FROM private.paid_order_amendment_refunds WHERE provider_refund_id = p_provider_id;
  IF match_reference IS NOT NULL THEN RETURN match_reference; END IF;
  -- Some events only name the capture. That selects an unresolved operation
  -- for lookup by its own reference. The event itself cannot settle it.
  SELECT CASE WHEN count(*) = 1 THEN min(reference) END INTO match_reference
  FROM private.paid_order_amendment_refunds WHERE capture_reference = p_capture_reference
    AND state IN ('uncertain','pending','processing','needs_attention') AND NOT preflight_review;
  RETURN match_reference;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_paid_order_amendment_refund(p_reference text,p_evidence jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a private.paid_order_amendments%ROWTYPE;
  r private.paid_order_amendment_refunds%ROWTYPE;
  new_state text := p_evidence->>'status';
  refund_id uuid;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amendment_refund_worker_required' USING ERRCODE = '42501';
  END IF;
  SELECT a0.* INTO a FROM private.paid_order_amendments a0
    JOIN private.paid_order_amendment_refunds r0 ON r0.amendment_id = a0.id WHERE r0.reference = p_reference;
  IF NOT FOUND THEN RETURN 'untracked'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('baci_order_payment:' || a.order_id,0));
  PERFORM 1 FROM public.orders WHERE id = a.order_id FOR UPDATE;
  SELECT * INTO r FROM private.paid_order_amendment_refunds WHERE reference = p_reference FOR UPDATE;
  IF r.preflight_review OR p_evidence->>'reference' IS DISTINCT FROM r.reference
    OR p_evidence->>'transactionId' IS DISTINCT FROM r.capture_id
    OR p_evidence->>'integration' IS DISTINCT FROM r.integration_id::text
    OR p_evidence->>'domain' IS DISTINCT FROM r.domain
    OR p_evidence->>'currency' IS DISTINCT FROM 'NGN'
    OR p_evidence->>'amount' IS DISTINCT FROM r.amount_minor::text
    OR COALESCE(p_evidence->>'id','') !~ '^[1-9][0-9]{0,19}$'
    OR (r.provider_refund_id IS NOT NULL AND r.provider_refund_id IS DISTINCT FROM p_evidence->>'id')
    OR COALESCE(new_state,'') NOT IN ('pending','processing','needs_attention','processed','failed')
    OR EXISTS (SELECT 1 FROM private.paid_order_amendment_refunds other
      WHERE other.id <> r.id AND other.integration_id = r.integration_id AND other.domain = r.domain
        AND other.provider_refund_id = p_evidence->>'id') THEN
    RETURN 'evidence_mismatch';
  END IF;
  IF r.state = 'processed' THEN RETURN 'processed'; END IF;
  IF r.state IN ('queued','void','failed') THEN
    RETURN CASE WHEN r.state = 'failed' AND new_state = 'failed' THEN 'failed' ELSE 'evidence_mismatch' END;
  END IF;
  IF r.state IN ('processing','needs_attention') AND new_state = 'pending' THEN RETURN r.state; END IF;
  UPDATE private.paid_order_amendment_refunds
  SET state = new_state, provider_refund_id = p_evidence->>'id'
  WHERE id = r.id;
  IF new_state = 'processed' THEN
    INSERT INTO public.transactions(merchant_id,order_id,transaction_type,amount,currency,status,gateway,gateway_reference,metadata)
    VALUES (a.merchant_id,a.order_id,'refund',r.amount_minor::numeric/100,'NGN','completed','paystack',
      p_evidence->>'id',jsonb_build_object('payment_transaction_id',r.payment_id,'paid_order_amendment_refund_id',r.id,
        'provider_refund_status','processed','provider_refund_id',p_evidence->>'id','amendment_refund_reference',r.reference))
    RETURNING id INTO refund_id;
  END IF;
  UPDATE private.paid_order_amendment_refunds
  SET refund_transaction_id = refund_id WHERE id = r.id AND refund_id IS NOT NULL;
  IF r.state <> new_state THEN
    INSERT INTO private.paid_order_amendment_events(amendment_id,event_type,details)
    VALUES (a.id,CASE WHEN new_state = 'processed' THEN 'customer_refund_verified' ELSE 'refund_status_changed' END,
      jsonb_build_object('operationId',r.id,'state',new_state,'transactionId',refund_id,
        'merchantAdjustmentPending',new_state = 'processed'));
  END IF;
  RETURN new_state;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_paid_order_amendment_workspace(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.orders%ROWTYPE;
  result jsonb;
  edit_allowed boolean;
  refund_allowed boolean;
  a private.paid_order_amendments%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002'; END IF;
  result := public.read_paid_order_amendment(p_order_id);
  edit_allowed := private.can_access_paid_order_amendment(o.merchant_id,'edit');
  refund_allowed := edit_allowed AND private.can_access_paid_order_amendment(o.merchant_id,'refund');
  SELECT * INTO a FROM private.paid_order_amendments WHERE order_id = o.id;
  RETURN result || jsonb_build_object(
    'canStart',edit_allowed AND a.id IS NULL AND o.source = 'online_store'
      AND o.payment_status = 'paid' AND o.shipping_status IN ('pending','processing')
      AND o.cancelled_at IS NULL AND o.shipment_id IS NULL AND o.shipment_booking_lock_token IS NULL
      AND EXISTS (SELECT 1 FROM private.paid_order_amendment_config
        WHERE merchant_id = o.merchant_id AND enabled AND cardinality(scenarios) > 0),
    'canEdit',edit_allowed,'canRefund',refund_allowed,
    'confirmationKey',CASE WHEN edit_allowed AND a.actor_id = auth.uid() THEN a.idempotency_key END,
    'customer',private.paid_order_amendment_customer_status(o.id),
    'refunds',CASE WHEN refund_allowed THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',r.id,'state',r.state,'amountMinor',r.amount_minor,
        'preflightReview',r.preflight_review)
        ORDER BY r.created_at DESC,r.id DESC)
      FROM private.paid_order_amendment_refunds r WHERE r.amendment_id = a.id
    ),'[]'::jsonb) ELSE '[]'::jsonb END,
    'bankEvidence',CASE WHEN edit_allowed AND a.id IS NOT NULL THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',q.id,'amountMinor',q.amount_minor,'status',q.allocation,
        'transactionId',q.transaction_id,'occurredAt',q.occurred_at))
      FROM (SELECT e.* FROM private.paid_order_bank_evidence e
        WHERE e.merchant_id = o.merchant_id AND e.direction = 'incoming' AND (
          (e.order_id = o.id AND e.allocation IN ('unapplied','top_up'))
          OR (e.allocation IS NULL AND e.bound_order_id = o.id)
        ) ORDER BY e.occurred_at DESC,e.id LIMIT 30) q
    ),'[]'::jsonb) ELSE '[]'::jsonb END
  );
END;
$$;
