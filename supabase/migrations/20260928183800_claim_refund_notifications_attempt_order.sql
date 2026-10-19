-- Order the cancellation-refund notification claim queue so a
-- permanently rejected notification cannot pin the queue head. The
-- claim previously ordered eligible rows by immutable created_at:
-- with retry eligibility shorter than the worker cadence and a
-- single send admitted per invocation, the oldest rejected row was
-- re-selected across most of its five attempts while newer pending
-- notifications waited behind it for hours. Never-attempted rows now
-- claim first, and retried rows rotate by least-recently-claimed so
-- one poison row yields the head to fresher work. The stale-claim
-- terminalization, exhaustion terminalization, backoff eligibility,
-- and claim effects are unchanged from
-- 20260927150001_paystack_cancellation_refund_completion.sql.

CREATE OR REPLACE FUNCTION public.claim_paystack_cancellation_refund_notifications_v1(p_limit integer)
RETURNS SETOF public.paystack_cancellation_refund_notifications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  -- Stale processing rows are deliberately not retried: delivery may have
  -- succeeded before the worker lost its acknowledgement.
  WITH stale AS (
    SELECT id FROM public.paystack_cancellation_refund_notifications
    WHERE status = 'processing' AND claimed_at < now() - interval '15 minutes'
    ORDER BY claimed_at LIMIT 50 FOR UPDATE SKIP LOCKED
  ) UPDATE public.paystack_cancellation_refund_notifications n
    SET status = 'delivery_uncertain',
        last_error = 'Claim expired; delivery outcome needs review'
    FROM stale WHERE n.id = stale.id;
  -- Rows that burned all five attempts are never claimable again: move
  -- them to the observable terminal state instead of stranding them as
  -- failed forever without an operational signal.
  WITH exhausted AS (
    SELECT id FROM public.paystack_cancellation_refund_notifications
    WHERE status IN ('pending', 'failed') AND attempts >= 5
    ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED
  ) UPDATE public.paystack_cancellation_refund_notifications n
    SET status = 'delivery_uncertain',
        last_error = 'Notification retry limit exhausted; delivery outcome needs review'
    FROM exhausted WHERE n.id = exhausted.id;
  RETURN QUERY WITH candidates AS (
    SELECT id FROM public.paystack_cancellation_refund_notifications
    WHERE status IN ('pending', 'failed') AND attempts < 5
      -- Failed rows back off between attempts so a single request cannot
      -- burn all five tries during a short outage; pending rows, which
      -- have never been claimed, stay immediately eligible.
      AND (
        claimed_at IS NULL
        OR claimed_at < now() - make_interval(mins => greatest(least(attempts, 4), 1) * 2)
      )
    -- Never-attempted rows (attempts = 0, claimed_at NULL) claim
    -- before retries, and retries rotate by least-recently-claimed:
    -- created_at alone let one permanently rejected row hold the head
    -- across its attempts while fresh notifications waited behind it.
    ORDER BY attempts ASC, claimed_at ASC NULLS FIRST, created_at
    LIMIT greatest(1, least(coalesce(p_limit, 20), 50))
    FOR UPDATE SKIP LOCKED
  ) UPDATE public.paystack_cancellation_refund_notifications n
    SET status = 'processing', attempts = n.attempts + 1,
        claimed_at = now(), claim_token = extensions.gen_random_uuid()
    FROM candidates WHERE n.id = candidates.id RETURNING n.*;
END;
$$;
