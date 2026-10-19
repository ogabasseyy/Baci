-- Sweep stamped manual Paystack refunds for post-completion contradictions.
--
-- The proof stamp converts a merchant Paystack claim into coverage
-- and persists the paired provider refund id, but the finalized
-- contradiction branch only selected PAYSTACK-gateway rows: a later
-- failed or needs-attention verdict for a manually attested refund
-- was never rechecked, so the flip stayed invisible even with
-- post-completion polling. This widens the finalized branch to
-- stamped manuals (processed stamp + numeric stored provider id,
-- which is what the recheck reads). The pre-finalization branch is
-- untouched: paid orders re-verify manuals through drain preflight
-- every run, so the sweep would only double-check them.

CREATE OR REPLACE FUNCTION
  public.select_completed_paystack_cancellation_refund_candidates_v1(
    p_limit integer,
    p_finalized_cutoff timestamptz,
    p_finalized_limit integer
  )
RETURNS TABLE (
  id uuid,
  order_id uuid,
  merchant_id uuid,
  gateway_reference text,
  amount numeric,
  currency text,
  description text,
  metadata jsonb,
  status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.id, s.order_id, s.merchant_id, s.gateway_reference,
           s.amount, s.currency, s.description, s.metadata, s.status
    FROM (
      (SELECT t.id, t.order_id, t.merchant_id, t.gateway_reference,
              t.amount, t.currency, t.description, t.metadata,
              t.status, t.updated_at, 0 AS branch
       FROM public.transactions t
       JOIN public.orders o ON o.id = t.order_id
       WHERE t.transaction_type = 'refund'
         AND (public.normalized_gateway_name_v1(t.gateway) = 'PAYSTACK'
           OR (public.normalized_gateway_name_v1(t.gateway) = 'MANUAL'
             AND t.metadata->>'provider_refund_status' = 'processed'
             AND t.metadata->>'provider_refund_id' ~ '^[0-9]+$'))
         AND t.status = 'completed'
         AND o.payment_status = 'refunded'
         AND o.shipping_status IN ('cancelled', 'canceled')
         AND o.cancelled_at IS NOT NULL
         -- Null timestamps are the oldest eligible rows: a bare
         -- less-than compares SQL unknown and would exclude a
         -- finalized legacy refund from the contradiction sweep
         -- forever.
         AND (t.updated_at IS NULL OR t.updated_at < p_finalized_cutoff)
       ORDER BY t.updated_at ASC NULLS FIRST
       LIMIT greatest(1, coalesce(p_finalized_limit, 5)))
      UNION ALL
      (SELECT t.id, t.order_id, t.merchant_id, t.gateway_reference,
              t.amount, t.currency, t.description, t.metadata,
              t.status, t.updated_at, 1 AS branch
       FROM public.transactions t
       JOIN public.orders o ON o.id = t.order_id
       WHERE t.transaction_type = 'refund'
         AND public.normalized_gateway_name_v1(t.gateway) = 'PAYSTACK'
         AND t.status = 'completed'
         -- Wedged orders (completed legs never flipped to paid) cancel
         -- and verify like paid orders: without 'pending' their
         -- completed refunds never reach the transition RPC.
         AND o.payment_status IN ('paid', 'partially_paid', 'pending')
         AND o.shipping_status IN ('cancelled', 'canceled')
         AND o.cancelled_at IS NOT NULL
       ORDER BY t.updated_at ASC NULLS FIRST
       LIMIT greatest(1, coalesce(p_limit, 25)))
    ) s
    -- Finalized rows first: the sweep is capped small, but trailing it
    -- would let a sustained backlog consume the whole row-start window
    -- and starve the contradiction recheck indefinitely.
    ORDER BY s.branch ASC, s.updated_at ASC NULLS FIRST;
END;
$$;
