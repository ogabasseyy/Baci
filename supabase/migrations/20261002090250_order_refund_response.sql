-- Response helper (3b/5): split from part 3 so each migration stays
-- under the 300-line limit. Shapes the manager response; called only
-- from private.manage_order_refund (part 4). SECURITY INVOKER like
-- its sibling.

-- Shapes the manager response: bounded refund history plus the
-- bounded audit-event tail, the derived status label, and the
-- capability flags. Pure read over the computed money/step state.
DROP FUNCTION IF EXISTS private.refund_status_response(uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,text,text,integer,integer,boolean,boolean);
DROP FUNCTION IF EXISTS private.refund_status_response(uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,text,text,integer,integer,boolean,boolean,boolean);
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
  p_manual_partial boolean,
  p_has_movement_evidence boolean,
  p_cancelled_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_history jsonb;
  v_legs jsonb;
  v_has_paystack boolean;
BEGIN
  -- Bound like the audit events: one row per partial manual with 30s
  -- status polling would otherwise grow every response unbounded.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',h.id,'amount',h.amount,'status',h.status,
    'method',COALESCE(h.metadata->>'method',h.gateway),
    'reference',COALESCE(h.metadata->>'reference',h.gateway_reference),
    'date',COALESCE(h.metadata->>'refunded_at',to_json(h.created_at)#>>'{}'),
    'note',h.metadata->>'note')
    ORDER BY h.created_at DESC),'[]') INTO v_history
    FROM (SELECT id,amount,status,metadata,gateway,gateway_reference,created_at
      FROM public.transactions
      WHERE order_id=p_order_id AND merchant_id=p_merchant_id AND transaction_type='refund'
      ORDER BY created_at DESC LIMIT 50) h;
  -- Pin candidates for the manual form's Paystack selector:
  -- completed Paystack captures with money still outstanding,
  -- mirroring the allocator's per-leg outstanding math, so the
  -- dashboard offers exactly what the server accepts (a Paystack
  -- attestation pinned anywhere else is unverifiable and
  -- rejected). Uncapped: unlike history, hiding a leg would
  -- strand its capture behind an unpinnable attestation, and
  -- legs are few per order.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',l.id,'amount',l.amount,
    'outstanding',l.outstanding,'gateway',l.gateway,'reference',l.gateway_reference)
    ORDER BY l.created_at,l.id),'[]') INTO v_legs
    FROM (SELECT p.id,p.amount,p.gateway,p.gateway_reference,p.created_at,
      GREATEST(p.amount-COALESCE((SELECT sum(r.amount)
        FROM public.transactions r
        WHERE r.order_id=p_order_id AND r.transaction_type='refund'
        AND r.status IN ('completed','refunded')
        AND upper(btrim(r.currency))=upper(btrim(p.currency))
        AND r.metadata->>'payment_transaction_id'=p.id::text),0),0) AS outstanding
      FROM public.transactions p
      WHERE p.order_id=p_order_id AND p.merchant_id=p_merchant_id
      AND p.transaction_type='payment' AND p.status='completed' AND p.amount>0
      AND upper(btrim(p.gateway))='PAYSTACK'
    ) l WHERE l.outstanding>0;
  -- Durable provider-backed signal for polling: legs lists only
  -- outstanding captures, so a fully refunded Paystack order shows
  -- legs [] while a later contradictory provider verdict can still
  -- re-open the balance. The panel keeps polling on this flag.
  SELECT EXISTS(SELECT 1 FROM public.transactions p
    WHERE p.order_id=p_order_id AND p.merchant_id=p_merchant_id
      AND p.transaction_type='payment' AND p.status='completed' AND p.amount>0
      AND upper(btrim(p.gateway))='PAYSTACK') INTO v_has_paystack;
  RETURN jsonb_build_object('currency',p_currency,'amountPaid',p_amount_paid,
    'refunded',p_refunded,'remaining',p_remaining,'pending',p_pending,
    'reversedInternal',p_reversed_internal,
    'hasPaystackPayment',v_has_paystack,
    -- A terminal quarantined step reports review before anything
    -- else: delivery_uncertain rows never resume, so pending
    -- evidence (or even full coverage) must not relabel them as
    -- processing or refunded and suppress the review guidance. A
    -- failed step with an error reports failed even under full
    -- coverage: the money is home but trusted finalization
    -- (settlement reversal, notifications) never ran, and only a
    -- rerun completes it. A failed step WITHOUT an error is a
    -- drain-owned requeue (every final manual re-arms one), so it
    -- reports queued AHEAD of the money-only refunded label: the
    -- panel treats refunded as terminal and stops polling, which
    -- would hide a later async failure of settlement reversal or
    -- notifications. A deferred step is the same shape (the drain
    -- reselects it for finalization), so it queues too. A claimed
    -- step is still worker-owned: coverage that lands mid-claim
    -- (a proof stamp or a concurrent reconciliation) must keep
    -- polling as processing, never report refunded before finish
    -- finalizes or fails. Only a completed (or absent) step lets
    -- full coverage report refunded.
    'status',CASE WHEN p_step_status='delivery_uncertain' THEN 'requires_review'
      WHEN p_pending>0 THEN 'processing'
      -- Open movement reviews veto both recovery flags, so any
      -- non-worker-owned step beside one must report review, not a
      -- terminal label: a contradictory provider verdict can
      -- otherwise leave the panel on failed or not_started with no
      -- guidance and no action.
      WHEN p_has_movement_evidence THEN 'requires_review'
      WHEN p_step_status='failed' AND p_step_error IS NOT NULL THEN 'failed'
      WHEN p_step_status='failed' AND p_step_error IS NULL THEN 'queued'
      WHEN p_step_status='deferred' THEN 'queued'
      WHEN p_step_status='claimed' THEN 'processing'
      WHEN p_remaining=0 AND p_refunded>0 THEN 'refunded'
      ELSE 'not_started' END,
    -- Raw worker/provider text never leaves the RPC: direct REST
    -- callers bypass the route masking, so map to the fixed labels
    -- here and derive the Paystack review signal as structured
    -- data (substring, mirroring the retired route rule: any
    -- mention of the provider means the review concerns Paystack).
    'error',private.describe_refund_worker_error_v1(p_step_error),
    'needsPaystackCheck',COALESCE(POSITION('paystack' IN LOWER(p_step_error))>0,FALSE),
    'attempts',COALESCE(p_step_attempts,0),
    'retryRequests',COALESCE(p_step_retry_requests,0),'history',v_history,
    'legs',v_legs,
    -- No actor/recorded_by: the status action serves view-only
    -- staff, and PostgREST RPC callers bypass the route mask, so
    -- peer identity is confined at the source, not the edge.
    'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'action',x.action,
      'details',x.details,'date',x.created_at) ORDER BY x.created_at DESC)
      FROM (SELECT id,action,details,created_at FROM public.order_refund_events
        WHERE order_id=p_order_id AND merchant_id=p_merchant_id
        ORDER BY created_at DESC LIMIT 50) x),'[]'::jsonb),
    -- A failed step under full coverage is retryable: rearming
    -- reruns trusted finalization (covered legs never re-initiate),
    -- which is the only recovery when the claim rolled back. Open
    -- movement reviews veto both flags exactly like pending
    -- evidence: the review queue (not a retry or a manual record
    -- beside unresolved provider money) is the only safe recovery.
    'canRetry',p_step_status='failed' AND p_step_error IS NOT NULL
      AND (p_remaining>0 OR p_refunded>0) AND p_pending=0
      AND NOT p_manual_partial AND NOT p_has_movement_evidence
      AND p_cancelled_at IS NOT NULL,
    -- Recording allocates only to the record helper's allocatable
    -- legs (completed non-wallet/savings, or refunded cash-like)
    -- with outstanding capacity: without a leg that can accept it,
    -- every submission ends in payment_ledger_requires_review, so a
    -- wallet/savings-only remainder must not advertise recovery.
    -- Mirrors record_manual_order_refund's leg scan exactly, plus
    -- its input-independent ledger vetoes: a foreign-currency leg,
    -- an unallocated terminal refund, or allocatable legs
    -- exceeding the live remainder each route every submission to
    -- review no matter what the merchant enters. (Pin, amount, and
    -- reference rejections depend on the submission itself, so the
    -- flag cannot precompute them.)
    'canRecordManual',p_remaining>0 AND p_pending=0
      AND NOT p_has_movement_evidence AND p_cancelled_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.transactions leg
        WHERE leg.order_id=p_order_id AND leg.merchant_id=p_merchant_id
        AND leg.transaction_type='payment'
        AND ((leg.status='completed'
            AND (leg.gateway IS NULL OR btrim(leg.gateway)=''
              OR upper(btrim(leg.gateway)) NOT IN ('WALLET','SAVINGS')))
          OR (leg.status='refunded'
            AND public.normalized_gateway_name_v1(leg.gateway) IN (
              'CASH','STORE_CREDIT','MANUAL','PAY_ON_DELIVERY')))
        AND leg.amount>COALESCE((
          SELECT SUM(r.amount) FROM public.transactions r
          WHERE r.order_id=p_order_id AND r.transaction_type='refund'
          AND r.status IN ('completed','refunded')
          AND upper(btrim(r.currency))=upper(btrim(leg.currency))
          AND r.metadata->>'payment_transaction_id'=leg.id::text),0))
      AND NOT EXISTS (
        SELECT 1 FROM public.transactions leg
        WHERE leg.order_id=p_order_id
        AND leg.transaction_type='payment'
        AND (leg.status='completed'
          OR (leg.status='refunded'
            AND public.normalized_gateway_name_v1(leg.gateway) IN (
              'CASH','STORE_CREDIT','MANUAL','PAY_ON_DELIVERY')))
        AND upper(btrim(leg.currency)) IS DISTINCT FROM upper(btrim(p_currency)))
      AND NOT EXISTS (
        SELECT 1 FROM public.transactions r
        WHERE r.order_id=p_order_id
        AND r.transaction_type='refund' AND r.status IN ('completed','refunded')
        AND r.metadata->>'payment_transaction_id' IS NULL)
      AND (SELECT COALESCE(SUM(GREATEST(leg.amount-COALESCE((
          SELECT SUM(r.amount) FROM public.transactions r
          WHERE r.order_id=p_order_id AND r.transaction_type='refund'
          AND r.status IN ('completed','refunded')
          AND upper(btrim(r.currency))=upper(btrim(leg.currency))
          AND r.metadata->>'payment_transaction_id'=leg.id::text),0),0)),0)
        FROM public.transactions leg
        WHERE leg.order_id=p_order_id AND leg.merchant_id=p_merchant_id
        AND leg.transaction_type='payment'
        AND ((leg.status='completed'
            AND (leg.gateway IS NULL OR btrim(leg.gateway)=''
              OR upper(btrim(leg.gateway)) NOT IN ('WALLET','SAVINGS')))
          OR (leg.status='refunded'
            AND public.normalized_gateway_name_v1(leg.gateway) IN (
              'CASH','STORE_CREDIT','MANUAL','PAY_ON_DELIVERY')))) <= p_remaining,
    'canManageRefunds',p_can_manage
      AND COALESCE(p_step_status,'') NOT IN ('claimed','delivery_uncertain'));
END; $$;
REVOKE ALL ON FUNCTION private.refund_status_response(uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,text,text,integer,integer,boolean,boolean,boolean,timestamptz)
  FROM PUBLIC,anon,authenticated;
-- Mirrors capped_refund_coverage_v1: service_role fires the manager,
-- and authenticated EXECUTE keeps any hypothetical direct call on the
-- clean schema-USAGE denial instead of the crashing function-ACL path.
GRANT EXECUTE ON FUNCTION private.refund_status_response(uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,text,text,integer,integer,boolean,boolean,boolean,timestamptz)
  TO service_role, authenticated;
