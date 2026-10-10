-- Interleave the abandoned-attempt candidate branches so
-- filing-only retries and missing-reference rows get sweep
-- capacity. The branches used to concatenate: a full main batch
-- (25 rows at a 5s verification timeout each) consumed the whole
-- 90s pass before the filing branches, and rotated mains become
-- eligible again after 55 minutes under the hourly cron — so the
-- same backlog could indefinitely prevent completed rows carrying
-- the review marker from filing their capture review and prevent
-- missing-reference attempts from being retired. Each branch now
-- numbers its rows and the outer query interleaves round-robin,
-- mains first (same pattern as the wedge queue): main-1,
-- filing-1, missing-1, main-2, ... Batch size is unchanged; only
-- the return order changes. Same signature: OR REPLACE keeps every
-- existing call on the new body.
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
    SELECT s.id, s.order_id, s.merchant_id, s.gateway,
           s.gateway_reference, s.amount, s.currency, s.status,
           s.metadata, s.platform_fee, s.paid_order
    FROM (
      (SELECT t.id, t.order_id, t.merchant_id, t.gateway,
              t.gateway_reference, t.amount, t.currency, t.status,
              t.metadata, t.platform_fee,
              jsonb_build_object('payment_status', o.payment_status) AS paid_order,
              0 AS branch,
              row_number() OVER (
                ORDER BY t.updated_at ASC NULLS FIRST
              ) AS rn
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
              jsonb_build_object('payment_status', o.payment_status) AS paid_order,
              1 AS branch,
              row_number() OVER (
                ORDER BY t.updated_at ASC NULLS FIRST
              ) AS rn
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
              jsonb_build_object('payment_status', o.payment_status) AS paid_order,
              2 AS branch,
              row_number() OVER (
                ORDER BY t.updated_at ASC NULLS FIRST
              ) AS rn
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
       LIMIT 5)
    ) s
    -- Round-robin across branches, mains first: a sustained main
    -- backlog consumes whole rounds, never the filing branches.
    ORDER BY s.rn ASC, s.branch ASC;
END;
$$;
