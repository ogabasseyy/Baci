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

-- The confirmation parameter changes the signature: without a DROP the
-- 7-argument overload would survive beside the new one, leaving an
-- unattested entry point behind.
DROP FUNCTION IF EXISTS private.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text);
CREATE OR REPLACE FUNCTION private.manage_order_refund(
  p_order_id uuid, p_action text DEFAULT 'status', p_amount numeric DEFAULT NULL,
  p_refunded_at timestamptz DEFAULT NULL, p_method text DEFAULT NULL,
  p_reference text DEFAULT NULL, p_note text DEFAULT NULL,
  p_confirmed boolean DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_order record;
  v_step record;
  v_payment record;
  v_manual_partial boolean;
  v_payment_refunded numeric;
  v_payment_pending numeric;
  v_refunded numeric;
  v_pending numeric;
  v_remaining numeric;
  v_reversed_internal numeric;
  v_leg_index integer;
  v_can_manage boolean;
  v_reference text;
  v_allocation numeric;
  v_leg_remaining numeric;
  v_constraint text;
  v_history jsonb;
  v_replay jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='28000'; END IF;
  IF p_action NOT IN ('status','retry','manual') THEN
    RAISE EXCEPTION 'invalid_refund_action' USING ERRCODE='22023';
  END IF;
  SELECT merchant_id,currency,amount_paid,shipping_status,cancelled_at INTO v_order
    FROM public.orders WHERE id=p_order_id FOR UPDATE;
  -- Missing and foreign orders share one error: distinct not-found vs
  -- forbidden responses would let any authenticated caller probe order
  -- existence across tenants.
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_forbidden' USING ERRCODE='42501'; END IF;
  v_can_manage := EXISTS (SELECT 1 FROM public.merchants WHERE id=v_order.merchant_id AND user_id=v_actor)
    OR public.check_staff_permission(v_actor,v_order.merchant_id,'orders','refund');
  IF NOT (v_can_manage OR (p_action='status'
    AND public.check_staff_permission(v_actor,v_order.merchant_id,'orders','view'))) THEN
    RAISE EXCEPTION 'refund_forbidden' USING ERRCODE='42501';
  END IF;
  SELECT status,error,attempts,retry_requests INTO v_step
    FROM public.order_cancellation_side_effects
    WHERE order_id=p_order_id AND step='refund' FOR UPDATE;
  -- Coverage counts matching money only: a foreign-currency row is an
  -- anomaly for review, and subtracting it would let the merchant
  -- record less than is owed while the order flips refunded.
  SELECT COALESCE(sum(amount) FILTER (WHERE status IN ('completed','refunded')),0),
    COALESCE(sum(amount) FILTER (WHERE status NOT IN ('completed','refunded','failed')),0)
    INTO v_refunded,v_pending FROM public.transactions
    WHERE order_id=p_order_id AND merchant_id=v_order.merchant_id AND transaction_type='refund'
    AND upper(btrim(currency))=upper(btrim(v_order.currency))
    -- Count only validated links: a row claiming a leg outside this
    -- order (or otherwise unresolvable) is corrupt evidence the
    -- worker quarantines, so counting it would understate the
    -- remainder while the order flips refunded. Compared as text so
    -- a malformed link excludes instead of raising.
    AND (metadata->>'payment_transaction_id' IS NULL
      OR EXISTS (SELECT 1 FROM public.transactions leg
        WHERE leg.id::text = transactions.metadata->>'payment_transaction_id'
          AND leg.order_id=p_order_id AND leg.merchant_id=v_order.merchant_id
          AND leg.transaction_type='payment'));
  -- Self-terminal payment legs (e.g. PayPal flips the payment row
  -- itself instead of inserting a refund row) count toward their side:
  -- refunded legs are returned money, refund_pending legs are
  -- in-flight money that blocks manual recording. External legs only,
  -- mirroring the aggregate claim; internal legs reverse through
  -- their own ledgers below.
  SELECT COALESCE(SUM(amount) FILTER (WHERE status='refunded'),0),
    COALESCE(SUM(amount) FILTER (WHERE status='refund_pending'),0)
    INTO v_payment_refunded,v_payment_pending FROM public.transactions
    WHERE order_id=p_order_id AND merchant_id=v_order.merchant_id
    AND transaction_type='payment' AND amount>0
    AND upper(btrim(currency))=upper(btrim(v_order.currency))
    AND COALESCE(public.normalized_gateway_name_v1(gateway),'') NOT IN (
      'WALLET','SAVINGS','STORE_CREDIT','CASH','MANUAL','PAY_ON_DELIVERY');
  v_refunded := v_refunded + v_payment_refunded;
  v_pending := v_pending + v_payment_pending;
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
  -- A partial manual record mismatches the worker's gateway matcher
  -- (gateway 'manual' never covers a Paystack leg), so retrying now
  -- would quarantine the step and hide further manual actions. Once a
  -- merchant starts manual coverage, they finish the balance manually.
  SELECT EXISTS(SELECT 1 FROM public.transactions
    WHERE order_id=p_order_id AND transaction_type='refund'
    AND status IN ('completed','refunded') AND gateway='manual')
    AND v_remaining>0 INTO v_manual_partial;

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
        'refunded_at',min(metadata->>'refunded_at'),'note',min(metadata->>'note')) INTO v_replay
        FROM public.transactions WHERE order_id=p_order_id AND transaction_type='refund'
        AND gateway='manual' AND metadata->>'reference'=v_reference;
      IF (v_replay->>'amount') IS NOT NULL THEN
        IF (v_replay->>'amount')::numeric<>p_amount OR v_replay->>'method'<>p_method
          OR (v_replay->>'refunded_at')::timestamptz<>p_refunded_at THEN
          RAISE EXCEPTION 'manual_reference_conflict' USING ERRCODE='P0001';
        END IF;
        -- Same transfer: money fields match, so no new money moves. A
        -- differing note is an annotation correction, not a new
        -- transfer (a new reference would double-record the money),
        -- so refresh it on every leg row instead of keeping stale
        -- audit text.
        IF COALESCE(v_replay->>'note','') IS DISTINCT FROM COALESCE(p_note,'') THEN
          UPDATE public.transactions SET metadata = metadata ||
            jsonb_build_object('note',p_note)
            WHERE order_id=p_order_id AND transaction_type='refund'
              AND gateway='manual' AND metadata->>'reference'=v_reference;
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
    IF v_manual_partial THEN
      RAISE EXCEPTION 'manual_completion_required' USING ERRCODE='P0001';
    END IF;
    IF v_step.status IS DISTINCT FROM 'failed' OR v_step.error IS NULL THEN
      RAISE EXCEPTION 'failed_refund_required' USING ERRCODE='P0001';
    END IF;
    UPDATE public.order_cancellation_side_effects SET attempts=0,
      retry_requests=retry_requests+1,last_retry_by=v_actor,last_retry_at=now(),
      claimed_at=now(),error=NULL WHERE order_id=p_order_id AND step='refund'
      RETURNING status,error,attempts,retry_requests INTO v_step;
  ELSIF p_action='manual' THEN
    -- Recording attests money already moved: the UI requires the
    -- checkbox and the route validates it, but direct RPC callers
    -- must attest too, and the audit trail must keep the proof.
    IF p_confirmed IS NOT TRUE THEN
      RAISE EXCEPTION 'refund_confirmation_required' USING ERRCODE='22023';
    END IF;
    -- The trusted finalization requires a cancellation timestamp; legacy
    -- rows without one need ops review before manual money can route
    -- through the aggregate claim.
    IF v_order.cancelled_at IS NULL THEN
      RAISE EXCEPTION 'payment_ledger_requires_review' USING ERRCODE='P0001';
    END IF;
    IF p_amount>v_remaining THEN RAISE EXCEPTION 'refund_exceeds_remaining' USING ERRCODE='P0001'; END IF;
    IF EXISTS (SELECT 1 FROM public.transactions WHERE order_id=p_order_id
      AND transaction_type='refund' AND status IN ('completed','refunded')
      AND metadata->>'payment_transaction_id' IS NULL) THEN
      RAISE EXCEPTION 'unallocated_refund_requires_review' USING ERRCODE='P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.transactions WHERE order_id=p_order_id
      AND transaction_type='payment' AND status='completed'
      AND upper(btrim(currency)) IS DISTINCT FROM upper(btrim(v_order.currency))) THEN
      RAISE EXCEPTION 'payment_currency_requires_review' USING ERRCODE='P0001';
    END IF;
    v_allocation := p_amount;
    v_leg_index := 0;
    -- Wallet and savings legs reverse through their own ledgers and are
    -- already counted in v_reversed_internal: allocating manual money to
    -- them would double-count it. Cash, store-credit, and other internal
    -- legs have no auto-reversal path, so they stay allocatable; missing
    -- or blank gateways stay allocatable like the worker's external-leg
    -- rule instead of silently stranding the manual amount.
    -- A concurrent twin racing the same merchant reference slips past
    -- the idempotency check above and collides here: scope the rescue
    -- to the reference index only, so an unrelated unique violation
    -- still surfaces instead of masquerading as a reference conflict.
    BEGIN
    FOR v_payment IN SELECT id,amount,currency FROM public.transactions
      WHERE order_id=p_order_id AND merchant_id=v_order.merchant_id
      AND transaction_type='payment' AND status='completed'
      AND (gateway IS NULL OR btrim(gateway)=''
        OR upper(btrim(gateway)) NOT IN ('WALLET','SAVINGS'))
      ORDER BY created_at,id
    LOOP
      SELECT GREATEST(v_payment.amount-COALESCE(sum(amount),0),0) INTO v_leg_remaining
        FROM public.transactions WHERE order_id=p_order_id AND transaction_type='refund'
        AND status IN ('completed','refunded')
        AND upper(btrim(currency))=upper(btrim(v_payment.currency))
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
            'reference',v_reference,'confirmed',true));
        v_allocation := v_allocation-v_leg_remaining;
      END IF;
      EXIT WHEN v_allocation=0;
    END LOOP;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'transactions_order_gateway_reference_key' THEN
        RAISE EXCEPTION 'manual_reference_conflict' USING ERRCODE='P0001';
      END IF;
      RAISE;
    END;
    IF v_allocation<>0 THEN RAISE EXCEPTION 'payment_ledger_requires_review' USING ERRCODE='P0001'; END IF;
    v_refunded := v_refunded+p_amount;
    v_remaining := v_remaining-p_amount;
    IF v_remaining=0 THEN
      -- Route through the trusted aggregate finalization instead of
      -- completing directly: the next service-role claim sees full
      -- coverage (manual rows count) and runs settlement reversal,
      -- notifications, and review close before completing the step.
      -- Upsert, not update: cash-only and legacy cancellations may
      -- have no refund row at all, and the drain only enumerates
      -- existing rows — a bare update would match zero rows, nothing
      -- would ever invoke the claim, and finalization would never
      -- run while the trigger still labels the order refunded.
      INSERT INTO public.order_cancellation_side_effects AS s
        (order_id,merchant_id,step,status,claim_token,attempts,error,result)
      VALUES (p_order_id,v_order.merchant_id,'refund','failed',gen_random_uuid(),0,NULL,
        jsonb_build_object('manual',true,'recorded_by',v_actor))
      ON CONFLICT (order_id,step) DO UPDATE SET attempts=0,
        error=NULL,result=jsonb_build_object('manual',true,'recorded_by',v_actor)
        RETURNING s.status,s.error,s.attempts,s.retry_requests INTO v_step;
    END IF;
  END IF;
  -- Bound like the audit events: one row per partial manual with 30s
  -- status polling would otherwise grow every response unbounded.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',h.id,'amount',h.amount,'status',h.status,
    'method',COALESCE(h.metadata->>'method',h.gateway),
    'reference',COALESCE(h.metadata->>'reference',h.gateway_reference),
    'date',COALESCE(h.metadata->>'refunded_at',to_json(h.created_at)#>>'{}'),
    'recorded_by',h.metadata->>'recorded_by')
    ORDER BY h.created_at DESC),'[]') INTO v_history
    FROM (SELECT id,amount,status,metadata,gateway,gateway_reference,created_at
      FROM public.transactions
      WHERE order_id=p_order_id AND merchant_id=v_order.merchant_id AND transaction_type='refund'
      ORDER BY created_at DESC LIMIT 50) h;
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
    'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'action',x.action,
      'details',x.details,'date',x.created_at,'actor',x.actor_id) ORDER BY x.created_at DESC)
      FROM (SELECT id,action,details,created_at,actor_id FROM public.order_refund_events
        WHERE order_id=p_order_id AND merchant_id=v_order.merchant_id
        ORDER BY created_at DESC LIMIT 50) x),'[]'::jsonb),
    'canRetry',v_step.status='failed' AND v_step.error IS NOT NULL AND v_remaining>0 AND v_pending=0
      AND NOT v_manual_partial,
    'canRecordManual',v_remaining>0 AND v_pending=0,
    'canManageRefunds',v_can_manage
      AND COALESCE(v_step.status,'') NOT IN ('claimed','delivery_uncertain'));
END; $$;
REVOKE ALL ON FUNCTION private.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text,boolean)
  FROM PUBLIC,anon,authenticated;
-- Preserve the repository boundary: authenticated callers have no private-schema usage.
-- This narrow delegate executes only the private function, which checks auth.uid and permissions.
DROP FUNCTION IF EXISTS public.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text);
CREATE OR REPLACE FUNCTION public.manage_order_refund(
  p_order_id uuid,p_action text DEFAULT 'status',p_amount numeric DEFAULT NULL,
  p_refunded_at timestamptz DEFAULT NULL,p_method text DEFAULT NULL,
  p_reference text DEFAULT NULL,p_note text DEFAULT NULL,
  p_confirmed boolean DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT private.manage_order_refund(p_order_id,p_action,p_amount,p_refunded_at,p_method,p_reference,p_note,p_confirmed);
$$;
REVOKE ALL ON FUNCTION public.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text,boolean)
  FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.manage_order_refund(uuid,text,numeric,timestamptz,text,text,text,boolean)
  TO authenticated;

-- A provider confirmation updates payment status without changing amount paid.
CREATE OR REPLACE FUNCTION private.sync_cancelled_order_refund_status()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  -- Order-less ledger refunds (e.g. the PiggyVest external-principal flow)
  -- have no order to audit: the events table requires order_id, so skip
  -- them instead of rolling their insert back on the NOT NULL check.
  IF NEW.order_id IS NULL THEN RETURN NEW; END IF;
  -- The audit event fires for terminal refund rows only; the payment
  -- label below also runs when a self-terminal payment leg (e.g. PayPal
  -- flips the payment row itself) lands, since no refund row arrives.
  IF (NEW.transaction_type='refund' AND NEW.status IN ('completed','refunded'))
    OR (NEW.transaction_type='payment' AND NEW.status='refunded') THEN
    IF NEW.transaction_type='refund' THEN
      INSERT INTO public.order_refund_events(order_id,merchant_id,actor_id,action,details)
      VALUES (NEW.order_id,NEW.merchant_id,auth.uid(),
        CASE WHEN NEW.gateway='manual' THEN 'manual_recorded' ELSE 'provider_confirmed' END,
        jsonb_build_object('amount',NEW.amount,
          'reference',COALESCE(NEW.metadata->>'reference',NEW.gateway_reference)));
    END IF;
    -- Coverage counts matching money only (a foreign-currency row must
    -- not flip the label while matching money is still owed) and
    -- includes self-terminal refunded payment legs.
    UPDATE public.orders o SET payment_status='refunded',updated_at=now()
      WHERE o.id=NEW.order_id AND o.merchant_id=NEW.merchant_id
        AND o.shipping_status IN ('cancelled','canceled') AND o.amount_paid>0
        AND o.amount_paid <= (SELECT COALESCE(sum(t.amount),0) FROM public.transactions t
          WHERE t.order_id=o.id AND t.merchant_id=o.merchant_id
            AND t.transaction_type='refund' AND t.status IN ('completed','refunded')
            AND upper(btrim(t.currency))=upper(btrim(o.currency))
            AND (t.metadata->>'payment_transaction_id' IS NULL
              OR EXISTS (SELECT 1 FROM public.transactions leg
                WHERE leg.id::text = t.metadata->>'payment_transaction_id'
                  AND leg.order_id=o.id AND leg.merchant_id=o.merchant_id
                  AND leg.transaction_type='payment')))
        + (SELECT COALESCE(sum(p.amount),0) FROM public.transactions p
          WHERE p.order_id=o.id AND p.merchant_id=o.merchant_id
            AND p.transaction_type='payment' AND p.status='refunded' AND p.amount>0
            AND upper(btrim(p.currency))=upper(btrim(o.currency))
            AND COALESCE(public.normalized_gateway_name_v1(p.gateway),'') NOT IN (
              'WALLET','SAVINGS','STORE_CREDIT','CASH','MANUAL','PAY_ON_DELIVERY'))
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
