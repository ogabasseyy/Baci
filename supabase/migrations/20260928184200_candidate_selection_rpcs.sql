-- Candidate-selection RPCs for the Paystack reconciliation workers.
-- PostgREST cannot express the normalized gateway predicate legacy
-- rows require (` Paystack ` must match), and a loose prefilter
-- would both discard the partial candidate indexes and let corrupt
-- rows occupy the bounded batch before exact filtering. These RPCs
-- match on normalized_gateway_name_v1(gateway) = 'PAYSTACK' inside
-- the database, so the normalized partial indexes apply and every
-- returned row is a genuine candidate. Predicates mirror the worker
-- queries exactly, including the joined order filters. Ordering is
-- NULLS FIRST: null timestamps are the oldest eligible rows, and the
-- default NULLS LAST would strand them beyond the bounded limit
-- forever. The abandoned RPC also returns a bounded trickle of
-- missing-reference attempts the worker files (never verifies) so
-- they stop blocking merchant cancellation with no operations trace.

CREATE OR REPLACE FUNCTION
  public.select_abandoned_paystack_attempt_candidates_v1(
    p_limit integer,
    p_or_cutoff timestamptz,
    p_or_recheck_cutoff timestamptz
  )
RETURNS TABLE (
  id uuid,
  order_id uuid,
  merchant_id uuid,
  gateway text,
  gateway_reference text,
  amount numeric,
  currency text,
  status text,
  metadata jsonb,
  platform_fee numeric,
  paid_order jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    (SELECT t.id, t.order_id, t.merchant_id, t.gateway,
            t.gateway_reference, t.amount, t.currency, t.status,
            t.metadata, t.platform_fee,
            jsonb_build_object('payment_status', o.payment_status)
     FROM public.transactions t
     JOIN public.orders o ON o.id = t.order_id
     WHERE t.transaction_type = 'payment'
       AND public.normalized_gateway_name_v1(t.gateway) = 'PAYSTACK'
       AND t.status IN ('pending', 'processing')
       AND o.payment_status IN ('paid', 'partially_paid')
       AND t.order_id IS NOT NULL
       AND t.gateway_reference IS NOT NULL
       AND t.metadata->'abandoned_sweep_resolution' IS NULL
       AND (t.created_at < p_or_cutoff OR t.created_at IS NULL)
       AND (t.updated_at < p_or_recheck_cutoff OR t.updated_at IS NULL)
     ORDER BY t.updated_at ASC NULLS FIRST
     LIMIT greatest(1, coalesce(p_limit, 25)))
    UNION ALL
    (SELECT t.id, t.order_id, t.merchant_id, t.gateway,
            t.gateway_reference, t.amount, t.currency, t.status,
            t.metadata, t.platform_fee,
            jsonb_build_object('payment_status', o.payment_status)
     FROM public.transactions t
     JOIN public.orders o ON o.id = t.order_id
     WHERE t.transaction_type = 'payment'
       AND public.normalized_gateway_name_v1(t.gateway) = 'PAYSTACK'
       AND t.status = 'completed'
       AND o.payment_status <> 'partially_paid'
       AND t.order_id IS NOT NULL
       AND t.gateway_reference IS NOT NULL
       AND t.metadata->'abandoned_sweep_resolution' IS NULL
       AND t.metadata->>'duplicate_capture_review_pending' = 'true'
       AND (t.created_at < p_or_cutoff OR t.created_at IS NULL)
       AND (t.updated_at < p_or_recheck_cutoff OR t.updated_at IS NULL)
     ORDER BY t.updated_at ASC NULLS FIRST
     LIMIT greatest(1, coalesce(p_limit, 25)))
    UNION ALL
    -- Missing-reference attempts can never verify (there is no
    -- reference to check) yet still block merchant cancellation
    -- while pending/processing: surface a bounded filing-only
    -- trickle so each gets an operations review and a terminal
    -- stamp instead of blocking cancellation forever with no
    -- trace. Same staleness gates as the main branch — young
    -- in-flight checkouts stay out.
    (SELECT t.id, t.order_id, t.merchant_id, t.gateway,
            t.gateway_reference, t.amount, t.currency, t.status,
            t.metadata, t.platform_fee,
            jsonb_build_object('payment_status', o.payment_status)
     FROM public.transactions t
     JOIN public.orders o ON o.id = t.order_id
     WHERE t.transaction_type = 'payment'
       AND public.normalized_gateway_name_v1(t.gateway) = 'PAYSTACK'
       AND t.status IN ('pending', 'processing')
       AND o.payment_status IN ('paid', 'partially_paid')
       AND t.order_id IS NOT NULL
       AND t.gateway_reference IS NULL
       AND t.metadata->'abandoned_sweep_resolution' IS NULL
       AND (t.created_at < p_or_cutoff OR t.created_at IS NULL)
       AND (t.updated_at < p_or_recheck_cutoff OR t.updated_at IS NULL)
     ORDER BY t.updated_at ASC NULLS FIRST
     LIMIT 5);
END;
$$;

CREATE OR REPLACE FUNCTION
  public.select_pending_paystack_cancellation_refund_candidates_v1(
    p_limit integer
  )
RETURNS TABLE (
  id uuid,
  order_id uuid,
  merchant_id uuid,
  gateway_reference text,
  amount numeric,
  currency text,
  metadata jsonb,
  status text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT t.id, t.order_id, t.merchant_id, t.gateway_reference,
           t.amount, t.currency, t.metadata, t.status
    FROM public.transactions t
    JOIN public.orders o ON o.id = t.order_id
    WHERE t.transaction_type = 'refund'
      AND public.normalized_gateway_name_v1(t.gateway) = 'PAYSTACK'
      AND t.status IN ('refund_pending', 'pending')
      AND t.metadata->>'refund_reconciliation_hold' IS NULL
      -- Only cancellation refunds: the order must be cancelled and the
      -- row must carry the cancellation audit description. Unrelated
      -- pending refunds would fail verification with an order mismatch
      -- and get held out of their own recovery path.
      AND o.cancelled_at IS NOT NULL
      AND t.description LIKE 'Refund for cancelled order #%'
    ORDER BY t.updated_at ASC NULLS FIRST
    LIMIT greatest(1, coalesce(p_limit, 25));
END;
$$;

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
         AND public.normalized_gateway_name_v1(t.gateway) = 'PAYSTACK'
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
