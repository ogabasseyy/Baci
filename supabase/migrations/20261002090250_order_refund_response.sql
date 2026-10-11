-- Response helper (3b/5): split from part 3 so each migration stays
-- under the 300-line limit. Shapes the manager response; called only
-- from private.manage_order_refund (part 4). SECURITY INVOKER like
-- its sibling.

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
    -- A terminal quarantined step reports review before anything
    -- else: delivery_uncertain rows never resume, so pending
    -- evidence (or even full coverage) must not relabel them as
    -- processing or refunded and suppress the review guidance. A
    -- failed step with an error reports failed even under full
    -- coverage: the money is home but trusted finalization
    -- (settlement reversal, notifications) never ran, and only a
    -- rerun completes it. A failed step WITHOUT an error stays a
    -- drain-owned requeue: reporting it failed would strand the
    -- zero-balance manual path behind a retry the branch rejects.
    'status',CASE WHEN p_step_status='delivery_uncertain' THEN 'requires_review'
      WHEN p_pending>0 THEN 'processing'
      WHEN p_step_status='failed' AND p_step_error IS NOT NULL THEN 'failed'
      WHEN p_remaining=0 AND p_refunded>0 THEN 'refunded'
      WHEN p_step_status='claimed' THEN 'processing'
      WHEN p_step_status='failed' AND p_step_error IS NULL THEN 'queued'
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
    'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'action',x.action,
      'details',x.details,'date',x.created_at,'actor',x.actor_id) ORDER BY x.created_at DESC)
      FROM (SELECT id,action,details,created_at,actor_id FROM public.order_refund_events
        WHERE order_id=p_order_id AND merchant_id=p_merchant_id
        ORDER BY created_at DESC LIMIT 50) x),'[]'::jsonb),
    -- A failed step under full coverage is retryable: rearming
    -- reruns trusted finalization (covered legs never re-initiate),
    -- which is the only recovery when the claim rolled back.
    'canRetry',p_step_status='failed' AND p_step_error IS NOT NULL
      AND (p_remaining>0 OR p_refunded>0) AND p_pending=0
      AND NOT p_manual_partial,
    'canRecordManual',p_remaining>0 AND p_pending=0,
    'canManageRefunds',p_can_manage
      AND COALESCE(p_step_status,'') NOT IN ('claimed','delivery_uncertain'));
END; $$;
REVOKE ALL ON FUNCTION private.refund_status_response(uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,text,text,integer,integer,boolean,boolean)
  FROM PUBLIC,anon,authenticated;
-- Mirrors capped_refund_coverage_v1: service_role fires the manager,
-- and authenticated EXECUTE keeps any hypothetical direct call on the
-- clean schema-USAGE denial instead of the crashing function-ACL path.
GRANT EXECUTE ON FUNCTION private.refund_status_response(uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,text,text,integer,integer,boolean,boolean)
  TO service_role, authenticated;
