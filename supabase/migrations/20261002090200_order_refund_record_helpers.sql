-- Manual-record and response helpers (3/5): the manager RPC's two
-- cohesive subroutines, extracted so each migration stays under the
-- 300-line limit. Called only from private.manage_order_refund (part 4),
-- which runs SECURITY DEFINER; both stay SECURITY INVOKER.

-- Records an attested manual transfer: validates the input, allocates
-- the amount across allocatable payment legs (one row per leg sharing
-- the merchant reference in metadata), and queues trusted aggregate
-- finalization when the balance hits zero. Returns the updated money
-- and step state as jsonb; raises the same refund_* errors the
-- manager surface maps.
CREATE OR REPLACE FUNCTION private.record_manual_order_refund(
  p_order_id uuid,
  p_merchant_id uuid,
  p_currency text,
  p_cancelled_at timestamptz,
  p_actor uuid,
  p_amount numeric,
  p_refunded_at timestamptz,
  p_method text,
  p_note text,
  p_confirmed boolean,
  p_reference text,
  p_remaining numeric,
  p_refunded numeric,
  p_step_status text,
  p_step_error text,
  p_step_attempts integer,
  p_step_retry_requests integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_payment record;
  v_allocation numeric;
  v_leg_remaining numeric;
  v_leg_index integer := 0;
  v_allocatable_outstanding numeric;
  v_constraint text;
  v_refunded numeric := p_refunded;
  v_remaining numeric := p_remaining;
  v_step_status text := p_step_status;
  v_step_error text := p_step_error;
  v_step_attempts integer := p_step_attempts;
  v_step_retry_requests integer := p_step_retry_requests;
BEGIN
    -- Recording attests money already moved: the UI requires the
    -- checkbox and the route validates it, but direct RPC callers
    -- must attest too, and the audit trail must keep the proof.
    IF p_confirmed IS NOT TRUE THEN
      RAISE EXCEPTION 'refund_confirmation_required' USING ERRCODE='22023';
    END IF;
    -- The trusted finalization requires a cancellation timestamp; legacy
    -- rows without one need ops review before manual money can route
    -- through the aggregate claim.
    IF p_cancelled_at IS NULL THEN
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
      AND upper(btrim(currency)) IS DISTINCT FROM upper(btrim(p_currency))) THEN
      RAISE EXCEPTION 'payment_currency_requires_review' USING ERRCODE='P0001';
    END IF;
    -- An overfunded ledger (allocatable legs exceed what manuals
    -- can still record) can never finalize: recording would zero
    -- the balance and flip the label while the claim still sees
    -- uncovered legs, with no further manual or retry able to
    -- finish. Compare against the live remainder, not the recorded
    -- amount paid — partial coverage shrinks what is recordable
    -- while the legs stay short. Mirror the worker preflight and
    -- route to review before allocating against these legs.
    SELECT COALESCE(SUM(GREATEST(leg.amount-COALESCE((
      SELECT SUM(r.amount) FROM public.transactions r
      WHERE r.order_id=p_order_id AND r.transaction_type='refund'
      AND r.status IN ('completed','refunded')
      AND upper(btrim(r.currency))=upper(btrim(leg.currency))
      AND r.metadata->>'payment_transaction_id'=leg.id::text),0),0)),0)
    INTO v_allocatable_outstanding FROM public.transactions leg
    WHERE leg.order_id=p_order_id AND leg.merchant_id=p_merchant_id
    AND leg.transaction_type='payment' AND leg.status='completed'
    AND (leg.gateway IS NULL OR btrim(leg.gateway)=''
      OR upper(btrim(leg.gateway)) NOT IN ('WALLET','SAVINGS'));
    IF v_allocatable_outstanding>v_remaining THEN
      RAISE EXCEPTION 'payment_ledger_requires_review' USING ERRCODE='P0001';
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
      WHERE order_id=p_order_id AND merchant_id=p_merchant_id
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
        VALUES (p_merchant_id,p_order_id,'refund',v_leg_remaining,v_payment.currency,
          'completed','manual',p_reference||'#'||v_leg_index::text,'Manual refund recorded by merchant',
          jsonb_build_object('payment_transaction_id',v_payment.id,'recorded_by',p_actor,
            'refunded_at',p_refunded_at,'method',p_method,'note',p_note,
            'reference',p_reference,'confirmed',true));
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
      VALUES (p_order_id,p_merchant_id,'refund','failed',gen_random_uuid(),0,NULL,
        jsonb_build_object('manual',true,'recorded_by',p_actor))
      ON CONFLICT (order_id,step) DO UPDATE SET attempts=0,
        error=NULL,result=jsonb_build_object('manual',true,'recorded_by',p_actor)
        RETURNING s.status,s.error,s.attempts,s.retry_requests INTO v_step_status,v_step_error,v_step_attempts,v_step_retry_requests;
    END IF;
  RETURN jsonb_build_object('refunded',v_refunded,'remaining',v_remaining,
    'stepStatus',v_step_status,'stepError',v_step_error,
    'stepAttempts',v_step_attempts,'stepRetryRequests',v_step_retry_requests);
END; $$;
REVOKE ALL ON FUNCTION private.record_manual_order_refund(uuid,uuid,text,timestamptz,uuid,numeric,timestamptz,text,text,boolean,text,numeric,numeric,text,text,integer,integer)
  FROM PUBLIC,anon,authenticated;
-- Mirrors capped_refund_coverage_v1: service_role fires the manager,
-- and authenticated EXECUTE keeps any hypothetical direct call on the
-- clean schema-USAGE denial instead of the crashing function-ACL path.
GRANT EXECUTE ON FUNCTION private.record_manual_order_refund(uuid,uuid,text,timestamptz,uuid,numeric,timestamptz,text,text,boolean,text,numeric,numeric,text,text,integer,integer)
  TO service_role, authenticated;

-- Shapes the manager response: bounded refund history plus the
-- bounded audit-event tail, the derived status label, and the
-- capability flags. Pure read over the computed money/step state.
CREATE OR REPLACE FUNCTION private.refund_status_response(
  p_order_id uuid,
  p_merchant_id uuid,
  p_currency text,
  p_amount_paid numeric,
  p_refunded numeric,
  p_remaining numeric,
  p_pending numeric,
  p_reversed_internal numeric,
  p_step_status text,
  p_step_error text,
  p_step_attempts integer,
  p_step_retry_requests integer,
  p_can_manage boolean,
  p_manual_partial boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_history jsonb;
BEGIN
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
      WHERE order_id=p_order_id AND merchant_id=p_merchant_id AND transaction_type='refund'
      ORDER BY created_at DESC LIMIT 50) h;
  RETURN jsonb_build_object('currency',p_currency,'amountPaid',p_amount_paid,
    'refunded',p_refunded,'remaining',p_remaining,'pending',p_pending,
    'reversedInternal',p_reversed_internal,
    'status',CASE WHEN p_remaining=0 AND p_refunded>0 THEN 'refunded'
      WHEN p_pending>0 THEN 'processing' WHEN p_step_status='claimed' THEN 'processing'
      WHEN p_step_status='delivery_uncertain' THEN 'requires_review'
      WHEN p_step_status='failed' AND p_step_error IS NULL THEN 'queued'
      WHEN p_step_status='failed' THEN 'failed' ELSE 'not_started' END,
    'error',p_step_error,'attempts',COALESCE(p_step_attempts,0),
    'retryRequests',COALESCE(p_step_retry_requests,0),'history',v_history,
    'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'action',x.action,
      'details',x.details,'date',x.created_at,'actor',x.actor_id) ORDER BY x.created_at DESC)
      FROM (SELECT id,action,details,created_at,actor_id FROM public.order_refund_events
        WHERE order_id=p_order_id AND merchant_id=p_merchant_id
        ORDER BY created_at DESC LIMIT 50) x),'[]'::jsonb),
    'canRetry',p_step_status='failed' AND p_step_error IS NOT NULL AND p_remaining>0 AND p_pending=0
      AND NOT p_manual_partial,
    'canRecordManual',p_remaining>0 AND p_pending=0,
    'canManageRefunds',p_can_manage
      AND COALESCE(p_step_status,'') NOT IN ('claimed','delivery_uncertain'));
END; $$;
REVOKE ALL ON FUNCTION private.refund_status_response(uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,text,text,integer,integer,boolean,boolean)
  FROM PUBLIC,anon,authenticated;
-- Same rationale as record_manual_order_refund above.
GRANT EXECUTE ON FUNCTION private.refund_status_response(uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,text,text,integer,integer,boolean,boolean)
  TO service_role, authenticated;
