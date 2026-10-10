-- Merchant commands use the same row lock as the cancellation worker.
ALTER TABLE public.order_cancellation_side_effects
  ADD COLUMN IF NOT EXISTS retry_requests integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retry_by uuid,
  ADD COLUMN IF NOT EXISTS last_retry_at timestamptz;

CREATE TABLE IF NOT EXISTS public.order_refund_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  actor_id uuid,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_refund_events_order_id_idx ON public.order_refund_events(order_id,created_at);
CREATE INDEX IF NOT EXISTS order_refund_events_merchant_id_idx ON public.order_refund_events(merchant_id);
ALTER TABLE public.order_refund_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_refund_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.order_refund_events TO authenticated;
GRANT ALL ON public.order_refund_events TO service_role;
CREATE POLICY merchant_refund_events_read ON public.order_refund_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.merchants m WHERE m.id=merchant_id AND m.user_id=auth.uid())
    OR public.check_staff_permission(auth.uid(),merchant_id,'orders','view'));
CREATE POLICY service_refund_events ON public.order_refund_events FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.order_refund_events(order_id,merchant_id,action,details)
SELECT s.order_id,s.merchant_id,'existing_state',
  jsonb_build_object('status',s.status,'attempts',s.attempts,'error',s.error)
FROM public.order_cancellation_side_effects s WHERE s.step='refund'
  AND NOT EXISTS (SELECT 1 FROM public.order_refund_events e WHERE e.order_id=s.order_id);

CREATE OR REPLACE FUNCTION private.audit_order_refund_step()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.step='refund' THEN
    INSERT INTO public.order_refund_events(order_id,merchant_id,actor_id,action,details)
    VALUES (NEW.order_id,NEW.merchant_id,auth.uid(),
      CASE WHEN TG_OP='UPDATE' AND NEW.retry_requests>OLD.retry_requests
        THEN 'retry_requested' ELSE NEW.status END,
      jsonb_build_object('attempts',NEW.attempts,'error',NEW.error,'retryRequests',NEW.retry_requests,
        'previousAttempts',CASE WHEN TG_OP='UPDATE' THEN OLD.attempts END,
        'previousError',CASE WHEN TG_OP='UPDATE' THEN OLD.error END));
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.audit_order_refund_step() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS audit_order_refund_step ON public.order_cancellation_side_effects;
CREATE TRIGGER audit_order_refund_step AFTER INSERT OR UPDATE OF status,attempts,retry_requests
  ON public.order_cancellation_side_effects FOR EACH ROW EXECUTE FUNCTION private.audit_order_refund_step();

CREATE OR REPLACE FUNCTION private.manage_order_refund(
  p_order_id uuid, p_action text DEFAULT 'status', p_amount numeric DEFAULT NULL,
  p_refunded_at timestamptz DEFAULT NULL, p_method text DEFAULT NULL,
  p_reference text DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_order public.orders%ROWTYPE;
  v_step public.order_cancellation_side_effects%ROWTYPE;
  v_payment record;
  v_refunded numeric;
  v_pending numeric;
  v_remaining numeric;
  v_reversed_internal numeric;
  v_leg_index integer;
  v_can_manage boolean;
  v_reference text;
  v_allocation numeric;
  v_leg_remaining numeric;
  v_history jsonb;
  v_replay jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  IF p_action NOT IN ('status','retry','manual') THEN
    RAISE EXCEPTION 'invalid_refund_action' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='P0002'; END IF;
  v_can_manage := EXISTS (SELECT 1 FROM public.merchants WHERE id=v_order.merchant_id AND user_id=v_actor)
    OR public.check_staff_permission(v_actor,v_order.merchant_id,'orders','refund');
  IF NOT (v_can_manage OR (p_action='status'
    AND public.check_staff_permission(v_actor,v_order.merchant_id,'orders','view'))) THEN
    RAISE EXCEPTION 'refund_forbidden' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_step FROM public.order_cancellation_side_effects
    WHERE order_id=p_order_id AND step='refund' FOR UPDATE;
  SELECT COALESCE(sum(amount) FILTER (WHERE status IN ('completed','refunded')),0),
    COALESCE(sum(amount) FILTER (WHERE status NOT IN ('completed','refunded','failed')),0)
    INTO v_refunded,v_pending FROM public.transactions
    WHERE order_id=p_order_id AND merchant_id=v_order.merchant_id AND transaction_type='refund';
  -- Internal redemptions return outside the refund ledger: wallet reversals
  -- credit customer_wallets and savings reversals restore the goal, so the
  -- outstanding balance excludes already-reversed internal amounts.
  SELECT COALESCE((
    SELECT sum(t.amount) FROM public.customer_wallet_transactions t
    WHERE t.source_id=p_order_id AND t.merchant_id=v_order.merchant_id
      AND t.source_type='order_reversal'),0)
    + COALESCE((
    SELECT sum(r.amount) FROM public.customer_savings_redemptions r
    WHERE r.order_id=p_order_id AND r.merchant_id=v_order.merchant_id
      AND r.metadata ? 'reversed_at'),0)
    INTO v_reversed_internal;
  v_refunded := v_refunded + v_reversed_internal;
  v_remaining := GREATEST(COALESCE(v_order.amount_paid,0)-v_refunded,0);

  IF p_action <> 'status' THEN
    IF v_order.shipping_status NOT IN ('cancelled','canceled') OR v_order.amount_paid <= 0 THEN
      RAISE EXCEPTION 'cancelled_paid_order_required' USING ERRCODE='P0001';
    END IF;
    IF p_action='manual' THEN
      v_reference := NULLIF(btrim(p_reference),'');
      IF p_amount IS NULL OR p_amount<=0 OR p_amount<>round(p_amount,2)
        OR p_refunded_at IS NULL OR p_refunded_at>now()
        OR p_method IS NULL OR p_method NOT IN ('paystack','bank_transfer','cash','other')
        OR v_reference IS NULL OR length(v_reference)>100
        OR COALESCE(length(p_note),0)>500 THEN
        RAISE EXCEPTION 'invalid_manual_refund' USING ERRCODE='22023';
      END IF;
      SELECT jsonb_build_object('amount',sum(amount),'method',min(metadata->>'method'),
        'refunded_at',min(metadata->>'refunded_at')) INTO v_replay
        FROM public.transactions WHERE order_id=p_order_id AND transaction_type='refund'
        AND gateway='manual' AND metadata->>'reference'=v_reference;
      IF (v_replay->>'amount') IS NOT NULL THEN
        IF (v_replay->>'amount')::numeric<>p_amount OR v_replay->>'method'<>p_method
          OR (v_replay->>'refunded_at')::timestamptz<>p_refunded_at THEN
          RAISE EXCEPTION 'manual_reference_conflict' USING ERRCODE='P0001';
        END IF;
        p_action := 'status'; -- Idempotent retry of an already recorded transfer.
      END IF;
    END IF;
    IF p_action <> 'status' AND (v_step.status IN ('claimed','delivery_uncertain') OR v_pending>0) THEN
      RAISE EXCEPTION 'refund_processing_or_requires_review' USING ERRCODE='P0001';
    END IF;
    IF p_action <> 'status' AND v_remaining<=0 THEN
      RAISE EXCEPTION 'already_refunded' USING ERRCODE='P0001';
    END IF;
  END IF;

  IF p_action='retry' THEN
    IF v_step.status IS DISTINCT FROM 'failed' OR v_step.error IS NULL THEN
      RAISE EXCEPTION 'failed_refund_required' USING ERRCODE='P0001';
    END IF;
    UPDATE public.order_cancellation_side_effects SET attempts=0,
      retry_requests=retry_requests+1,last_retry_by=v_actor,last_retry_at=now(),
      claimed_at=now(),error=NULL WHERE order_id=p_order_id AND step='refund'
      RETURNING * INTO v_step;
  ELSIF p_action='manual' THEN
    IF p_amount>v_remaining THEN RAISE EXCEPTION 'refund_exceeds_remaining' USING ERRCODE='P0001'; END IF;
    IF EXISTS (SELECT 1 FROM public.transactions WHERE order_id=p_order_id
      AND transaction_type='refund' AND status IN ('completed','refunded')
      AND metadata->>'payment_transaction_id' IS NULL) THEN
      RAISE EXCEPTION 'unallocated_refund_requires_review' USING ERRCODE='P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.transactions WHERE order_id=p_order_id
      AND transaction_type='payment' AND status='completed'
      AND currency IS DISTINCT FROM v_order.currency) THEN
      RAISE EXCEPTION 'payment_currency_requires_review' USING ERRCODE='P0001';
    END IF;
    v_allocation := p_amount;
    v_leg_index := 0;
    FOR v_payment IN SELECT id,amount,currency FROM public.transactions
      WHERE order_id=p_order_id AND merchant_id=v_order.merchant_id
      AND transaction_type='payment' AND status='completed' ORDER BY created_at,id
    LOOP
      SELECT GREATEST(v_payment.amount-COALESCE(sum(amount),0),0) INTO v_leg_remaining
        FROM public.transactions WHERE order_id=p_order_id AND transaction_type='refund'
        AND status IN ('completed','refunded')
        AND metadata->>'payment_transaction_id'=v_payment.id::text;
      v_leg_remaining := LEAST(v_leg_remaining,v_allocation);
      IF v_leg_remaining>0 THEN
        -- One manual transfer can span several payment legs, but the
        -- (order_id, gateway_reference) unique index rejects a repeated
        -- reference: each allocation row gets a unique ledger identifier
        -- while the merchant reference stays queryable in metadata.
        v_leg_index := v_leg_index + 1;
        INSERT INTO public.transactions (merchant_id,order_id,transaction_type,amount,currency,
          status,gateway,gateway_reference,description,metadata)
        VALUES (v_order.merchant_id,p_order_id,'refund',v_leg_remaining,v_payment.currency,
          'completed','manual',v_reference||'#'||v_leg_index::text,'Manual refund recorded by merchant',
          jsonb_build_object('payment_transaction_id',v_payment.id,'recorded_by',v_actor,
            'refunded_at',p_refunded_at,'method',p_method,'note',p_note,
            'reference',v_reference));
        v_allocation := v_allocation-v_leg_remaining;
      END IF;
      EXIT WHEN v_allocation=0;
    END LOOP;
    IF v_allocation<>0 THEN RAISE EXCEPTION 'payment_ledger_requires_review' USING ERRCODE='P0001'; END IF;
    v_refunded := v_refunded+p_amount;
    v_remaining := v_remaining-p_amount;
    IF v_remaining=0 THEN
      UPDATE public.orders SET payment_status='refunded',updated_at=now() WHERE id=p_order_id;
      UPDATE public.order_cancellation_side_effects SET status='completed',completed_at=now(),
        error=NULL,result=jsonb_build_object('manual',true,'recorded_by',v_actor)
        WHERE order_id=p_order_id AND step='refund' RETURNING * INTO v_step;
    END IF;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'amount',amount,'status',status,
    'method',COALESCE(metadata->>'method',gateway),
    'reference',COALESCE(metadata->>'reference',gateway_reference),
    'date',COALESCE(metadata->>'refunded_at',created_at::text),'recorded_by',metadata->>'recorded_by')
    ORDER BY created_at DESC),'[]') INTO v_history FROM public.transactions
    WHERE order_id=p_order_id AND merchant_id=v_order.merchant_id AND transaction_type='refund';
  RETURN jsonb_build_object('currency',v_order.currency,'amountPaid',v_order.amount_paid,
    'refunded',v_refunded,'remaining',v_remaining,'pending',v_pending,
    'reversedInternal',v_reversed_internal,
    'status',CASE WHEN v_remaining=0 AND v_refunded>0 THEN 'refunded'
      WHEN v_pending>0 THEN 'processing' WHEN v_step.status='claimed' THEN 'processing'
      WHEN v_step.status='delivery_uncertain' THEN 'requires_review'
      WHEN v_step.status='failed' AND v_step.error IS NULL THEN 'queued'
      WHEN v_step.status='failed' THEN 'failed' ELSE 'not_started' END,
    'error',v_step.error,'attempts',COALESCE(v_step.attempts,0),
    'retryRequests',COALESCE(v_step.retry_requests,0),'history',v_history,
    'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,
      'details',e.details,'date',e.created_at,'actor',e.actor_id) ORDER BY e.created_at DESC)
      FROM public.order_refund_events e WHERE e.order_id=p_order_id AND e.merchant_id=v_order.merchant_id),'[]'::jsonb),
    'canRetry',v_step.status='failed' AND v_step.error IS NOT NULL AND v_remaining>0 AND v_pending=0,
    'canRecordManual',v_remaining>0 AND v_pending=0,
    'canManageRefunds',v_can_manage
      AND COALESCE(v_step.status,'') NOT IN ('claimed','delivery_uncertain'));
END; $$;
REVOKE ALL ON FUNCTION private.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text)
  FROM PUBLIC,anon,authenticated;
-- Preserve the repository boundary: authenticated callers have no private-schema usage.
-- This narrow delegate executes only the private function, which checks auth.uid and permissions.
CREATE OR REPLACE FUNCTION public.manage_order_refund(
  p_order_id uuid,p_action text DEFAULT 'status',p_amount numeric DEFAULT NULL,
  p_refunded_at timestamptz DEFAULT NULL,p_method text DEFAULT NULL,
  p_reference text DEFAULT NULL,p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT private.manage_order_refund(p_order_id,p_action,p_amount,p_refunded_at,p_method,p_reference,p_note);
$$;
REVOKE ALL ON FUNCTION public.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text)
  TO authenticated;

-- A provider confirmation updates payment status without changing amount paid.
CREATE OR REPLACE FUNCTION private.sync_cancelled_order_refund_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.transaction_type='refund' AND NEW.status IN ('completed','refunded') THEN
    INSERT INTO public.order_refund_events(order_id,merchant_id,actor_id,action,details)
    VALUES (NEW.order_id,NEW.merchant_id,auth.uid(),
      CASE WHEN NEW.gateway='manual' THEN 'manual_recorded' ELSE 'provider_confirmed' END,
      jsonb_build_object('amount',NEW.amount,
        'reference',COALESCE(NEW.metadata->>'reference',NEW.gateway_reference)));
    UPDATE public.orders o SET payment_status='refunded',updated_at=now()
      WHERE o.id=NEW.order_id AND o.merchant_id=NEW.merchant_id
        AND o.shipping_status IN ('cancelled','canceled') AND o.amount_paid>0
        AND o.amount_paid <= (SELECT COALESCE(sum(t.amount),0) FROM public.transactions t
          WHERE t.order_id=o.id AND t.merchant_id=o.merchant_id
            AND t.transaction_type='refund' AND t.status IN ('completed','refunded'))
        + (SELECT COALESCE(sum(w.amount),0) FROM public.customer_wallet_transactions w
          WHERE w.source_id=o.id AND w.merchant_id=o.merchant_id
            AND w.source_type='order_reversal')
        + (SELECT COALESCE(sum(r.amount),0) FROM public.customer_savings_redemptions r
          WHERE r.order_id=o.id AND r.merchant_id=o.merchant_id
            AND r.metadata ? 'reversed_at');
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION private.sync_cancelled_order_refund_status() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS sync_cancelled_order_refund_status ON public.transactions;
CREATE TRIGGER sync_cancelled_order_refund_status AFTER INSERT OR UPDATE OF status
  ON public.transactions FOR EACH ROW EXECUTE FUNCTION private.sync_cancelled_order_refund_status();
