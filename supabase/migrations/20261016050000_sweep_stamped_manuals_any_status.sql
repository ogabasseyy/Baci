-- Recheck stamped manuals after a contradiction verdict.
--
-- The sweep admitted stamped manuals only while their stored
-- provider status was `processed`. A contradiction verdict
-- (needs-attention, failed) deliberately leaves a completed row
-- completed but replaces that stored status, so the row dropped out
-- of the sweep: a later provider recovery to `processed` was never
-- observed and the order could remain falsely reopened indefinitely.
-- Both branches now select stamped manuals by their numeric stored
-- provider id regardless of the last provider status, subject to the
-- same lifecycle gates as native Paystack rows. Failed stamped
-- manuals reselect too: the transition demotes them from completed
-- on a failed verdict, and neither preflight (which never touches
-- failed rows) nor the webhook (which may never arrive) would
-- otherwise recheck them. Native failed rows stay out: without a
-- fresh provider check stamping non-acceptance they are not
-- definitively dead, and the webhook observes their recovery by
-- gateway reference. Repeat verdicts stay cheap: the transition
-- no-ops (rotating updated_at) when the row already reflects the
-- verdict and its failure alert is durable. The companion
-- transition widening lives in 20261016060000 (split for the
-- 300-line modularity gate).

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
           AND t.status = 'completed'
           OR (public.normalized_gateway_name_v1(t.gateway) = 'MANUAL'
             AND t.metadata->>'provider_refund_id' ~ '^[0-9]+$'
             AND t.status IN ('completed', 'failed')))
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
         -- Completed stamped manuals stay out: paid orders re-verify
         -- them through drain preflight every run. Failed stamped
         -- manuals come in: preflight never touches failed rows, so
         -- without this a failure on a paid order would never
         -- recheck.
         AND (public.normalized_gateway_name_v1(t.gateway) = 'PAYSTACK'
           AND t.status = 'completed'
           OR (public.normalized_gateway_name_v1(t.gateway) = 'MANUAL'
             AND t.metadata->>'provider_refund_id' ~ '^[0-9]+$'
             AND t.status = 'failed'))
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
