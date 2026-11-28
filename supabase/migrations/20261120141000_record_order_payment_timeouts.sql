-- Record cleanup provenance outside customer-writable order data. The 72-hour
-- expiry remains independent of the provider's ability to settle later.
CREATE TABLE IF NOT EXISTS private.order_payment_timeouts (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  timed_out_at timestamptz NOT NULL,
  reinstated_transaction_id uuid REFERENCES public.transactions(id),
  reinstated_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS order_payment_timeouts_reinstated_transaction_idx
  ON private.order_payment_timeouts (reinstated_transaction_id)
  WHERE reinstated_transaction_id IS NOT NULL;

ALTER TABLE private.order_payment_timeouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.order_payment_timeouts FROM PUBLIC, anon, authenticated;
-- Cleanup can add provenance. The definer recovery function owns updates
-- so callers cannot mark payments as reinstated by editing this table.
GRANT SELECT, INSERT ON private.order_payment_timeouts TO service_role;
CREATE POLICY service_record_order_payment_timeouts ON private.order_payment_timeouts
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY service_read_order_payment_timeouts ON private.order_payment_timeouts
  FOR SELECT TO service_role;

CREATE OR REPLACE FUNCTION public.mark_abandoned_orders(hours_threshold int DEFAULT 72)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_order_id uuid;
  v_candidate_ids uuid[];
BEGIN
  IF hours_threshold IS NULL OR hours_threshold < 1 OR hours_threshold > 720 THEN
    RAISE EXCEPTION 'invalid_hours_threshold: % (expected 1-720)', hours_threshold
      USING ERRCODE = '22023';
  END IF;

  -- Use the same advisory lock as reinstatement for every order the cleanup
  -- may cancel, before taking any order row locks.
  SELECT coalesce(array_agg(o.id ORDER BY o.id), '{}'::uuid[])
  INTO v_candidate_ids
  FROM public.orders o
    WHERE (
        o.payment_status = 'unpaid'
        AND o.created_at < (now() - (hours_threshold * interval '1 hour'))
      ) OR (
        o.payment_status IN ('pending', 'bnpl_pending')
        AND o.payment_method IN ('credit_direct', 'klump')
        AND o.updated_at < (now() - (hours_threshold * interval '1 hour'))
      );

  FOR v_order_id IN
    SELECT candidate_id FROM unnest(v_candidate_ids) AS candidates(candidate_id)
    ORDER BY candidate_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('baci_order_payment:' || v_order_id::text, 0)
    );
  END LOOP;

  WITH loyalty_orders AS MATERIALIZED (
    SELECT used_on_order_id FROM public.reward_redemptions
    WHERE used_on_order_id IS NOT NULL
  ), eligible_orders AS MATERIALIZED (
    SELECT o.id, o.payment_method, o.source, o.shipping_status,
      o.cancelled_at, o.cancelled_by, o.cancellation_reason
    FROM public.orders o
    WHERE o.id = ANY(v_candidate_ids)
      AND (
        (o.payment_status = 'unpaid'
          AND o.created_at < (now() - (hours_threshold * interval '1 hour')))
        OR (o.payment_status IN ('pending', 'bnpl_pending')
          AND o.payment_method IN ('credit_direct', 'klump')
          AND o.updated_at < (now() - (hours_threshold * interval '1 hour')))
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.oxygen_workflows ow WHERE ow.order_id = o.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.reconciliation_review rr
        WHERE o.payment_method = 'credit_direct'
          AND rr.order_id = o.id
          AND rr.issue_type = 'credit_direct_confirmation_missing'
          AND rr.resolved_at IS NULL
          AND rr.metadata->>'source' = 'credit_direct_sdk_on_success'
          AND (rr.metadata->>'client_completed_at')::timestamptz
            > (clock_timestamp() - interval '14 days')
      )
  ), cancelled_orders AS (
    UPDATE public.orders o
    SET
      payment_status = 'cancelled',
      shipping_status = CASE
        WHEN o.payment_status IN ('pending', 'bnpl_pending')
          AND o.payment_method IN ('credit_direct', 'klump')
        THEN 'cancelled'
        ELSE o.shipping_status
      END,
      cancelled_at = CASE
        WHEN o.payment_status IN ('pending', 'bnpl_pending')
          AND o.payment_method IN ('credit_direct', 'klump')
        THEN COALESCE(o.cancelled_at, now())
        ELSE o.cancelled_at
      END,
      updated_at = now()
    FROM eligible_orders eligible
    WHERE o.id = eligible.id
      AND ((
        (
          o.payment_status = 'unpaid'
          AND o.created_at < (now() - (hours_threshold * interval '1 hour'))
        )
        OR (
          o.payment_status IN ('pending', 'bnpl_pending')
          AND o.payment_method IN ('credit_direct', 'klump')
          AND o.updated_at < (now() - (hours_threshold * interval '1 hour'))
        )
      ))
      AND NOT EXISTS (
        SELECT 1 FROM public.oxygen_workflows ow WHERE ow.order_id = o.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.reconciliation_review rr
        WHERE o.payment_method = 'credit_direct'
          AND rr.order_id = o.id
          AND rr.issue_type = 'credit_direct_confirmation_missing'
          AND rr.resolved_at IS NULL
          AND rr.metadata->>'source' = 'credit_direct_sdk_on_success'
          AND (rr.metadata->>'client_completed_at')::timestamptz
            > (clock_timestamp() - interval '14 days')
      )
    RETURNING o.id, o.payment_method, o.updated_at, o.cancelled_at,
      o.cancelled_by, o.cancellation_reason, o.shipping_status
  ), recorded_timeouts AS (
    INSERT INTO private.order_payment_timeouts (order_id, timed_out_at)
    SELECT c.id, c.updated_at FROM cancelled_orders c
    JOIN eligible_orders before_cleanup ON before_cleanup.id = c.id
    WHERE c.payment_method IS DISTINCT FROM 'uba_redvault'
      AND before_cleanup.cancelled_by IS NULL
      AND before_cleanup.cancellation_reason IS NULL
      AND before_cleanup.source IN ('online_store', 'mobile_app')
      AND before_cleanup.shipping_status = 'pending'
      AND before_cleanup.cancelled_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM loyalty_orders l WHERE l.used_on_order_id = c.id)
    ON CONFLICT (order_id) DO NOTHING
  )
  UPDATE public.reconciliation_review rr
  SET resolved_at = clock_timestamp(),
      resolution_notes = COALESCE(
        rr.resolution_notes,
        'Provider confirmation deadline expired; order was cancelled as abandoned.'
      )
  FROM cancelled_orders c
  WHERE c.payment_method = 'credit_direct'
    AND rr.order_id = c.id
    AND rr.issue_type = 'credit_direct_confirmation_missing'
    AND rr.resolved_at IS NULL;
END;
$$;

COMMENT ON FUNCTION public.mark_abandoned_orders(integer) IS
  'Cancels stale unpaid/BNPL attempts while giving explicit Credit Direct SDK-success cases a bounded reconciliation window.';

REVOKE ALL ON FUNCTION public.mark_abandoned_orders(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_abandoned_orders(integer) TO service_role;
