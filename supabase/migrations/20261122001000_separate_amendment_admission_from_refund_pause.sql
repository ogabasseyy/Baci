-- Admission pause blocks new amendments, while existing obligations can still
-- settle. Use automated_paystack_refunds to stop new provider POSTs without
-- interrupting reconciliation of already submitted refunds.
CREATE OR REPLACE FUNCTION public.list_due_paid_order_amendment_refunds(p_limit integer)
RETURNS SETOF uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'amendment_refund_worker_required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT r.id FROM private.paid_order_amendment_refunds r
  JOIN private.paid_order_amendments a ON a.id = r.amendment_id
  JOIN private.paid_order_amendment_config c ON c.merchant_id = a.merchant_id
  WHERE r.next_lookup_at <= now() AND a.state = 'awaiting_refund'
    AND (r.state IN ('uncertain','pending','processing','needs_attention')
      OR (r.state = 'queued' AND c.automated_paystack_refunds AND c.paystack_integration_id = r.integration_id))
  ORDER BY r.next_lookup_at,r.id LIMIT greatest(0,least(p_limit,20));
END;
$$;

-- Lease preflight work separately from dispatch. A failed config or history
-- check can retry without marking an undispatched refund as uncertain.
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
    OR config.paystack_integration_id IS DISTINCT FROM r.integration_id
    OR EXISTS (SELECT 1 FROM public.transactions WHERE order_id = a.order_id AND transaction_type = 'refund'
      AND status NOT IN ('failed','cancelled'))) THEN RETURN NULL; END IF;
  UPDATE private.paid_order_amendment_refunds
  SET next_lookup_at = clock_timestamp() + interval '5 minutes' WHERE id = r.id;
  RETURN jsonb_build_object('submit',submit,'reference',r.reference,'captureReference',r.capture_reference,
    'captureId',r.capture_id,'amountMinor',r.amount_minor,'integrationId',r.integration_id::text,'domain',r.domain);
END;
$$;

-- The worker calls this after checking the provider account and history,
-- immediately before POST. Recovery can void a queued attempt before then.
CREATE OR REPLACE FUNCTION public.authorize_paid_order_amendment_refund_dispatch(p_attempt uuid,p_clear boolean)
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
  IF p_clear IS NULL OR a.state <> 'awaiting_refund' OR r.state <> 'queued'
    OR NOT COALESCE(config.automated_paystack_refunds,false)
    OR config.paystack_integration_id IS DISTINCT FROM r.integration_id THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.transactions WHERE order_id = a.order_id AND transaction_type = 'refund'
      AND status NOT IN ('failed','cancelled')) THEN p_clear := false; END IF;
  UPDATE private.paid_order_amendment_refunds
    SET state = CASE WHEN p_clear THEN 'uncertain' ELSE 'needs_attention' END,
      next_lookup_at = clock_timestamp() + interval '5 minutes'
    WHERE id = r.id;
  INSERT INTO private.paid_order_amendment_events(amendment_id,event_type,details)
    VALUES (a.id,CASE WHEN p_clear THEN 'refund_submission_claimed' ELSE 'refund_evidence_review' END,
      jsonb_build_object('operationId',r.id,'amountMinor',r.amount_minor));
  RETURN p_clear;
END;
$$;
