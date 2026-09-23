-- Project repair_id for orderless repair-pickup tracking notifications so the
-- GIGL notification worker never needs a generic repairs table read on the
-- privileged event-pipeline client.

DROP FUNCTION IF EXISTS public.claim_shipment_tracking_notifications(integer, text);

CREATE OR REPLACE FUNCTION public.claim_shipment_tracking_notifications(
  p_limit integer, p_worker_id text
)
RETURNS TABLE (
  id uuid, shipment_id uuid, tracking_epoch_id uuid, order_id uuid,
  merchant_id uuid, tracking_event_id uuid, audience text, notification_kind text,
  attempt_count integer, max_attempts integer, repair_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'tracking notification claims require service role'
      USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR nullif(btrim(p_worker_id), '') IS NULL THEN
    RAISE EXCEPTION 'tracking notification claim arguments are invalid'
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH expired_delivery AS (
    UPDATE public.shipment_tracking_notification_outbox AS outbox
    SET status = 'failed', locked_at = NULL, locked_by = NULL,
      next_attempt_at = now(),
      last_error = coalesce(outbox.last_error, 'delivery_outcome_unknown'),
      updated_at = now()
    WHERE outbox.status = 'processing'
      AND outbox.delivery_started_at IS NOT NULL
      AND outbox.locked_at < now() - interval '15 minutes'
    RETURNING outbox.id
  ), candidates AS (
    SELECT outbox.id
    FROM public.shipment_tracking_notification_outbox AS outbox
    JOIN public.shipment_tracking_events AS event
      ON event.id = outbox.tracking_event_id
    WHERE outbox.attempt_count < outbox.max_attempts
      AND (
        (outbox.status = 'pending' AND outbox.next_attempt_at <= now())
        OR (
          outbox.status = 'processing'
          AND outbox.delivery_started_at IS NULL
          AND outbox.locked_at < now() - interval '15 minutes'
        )
      )
    ORDER BY event.occurred_at ASC NULLS LAST,
      outbox.created_at ASC,
      outbox.id ASC
    LIMIT p_limit FOR UPDATE OF outbox SKIP LOCKED
  ), claimed AS (
    UPDATE public.shipment_tracking_notification_outbox AS outbox
    SET status = 'processing', locked_at = now(), locked_by = btrim(p_worker_id),
      updated_at = now()
    FROM candidates WHERE outbox.id = candidates.id
    RETURNING outbox.id, outbox.shipment_id, outbox.tracking_epoch_id,
      outbox.order_id, outbox.merchant_id, outbox.tracking_event_id,
      outbox.audience, outbox.notification_kind, outbox.attempt_count,
      outbox.max_attempts, outbox.created_at
  )
  SELECT claimed.id, claimed.shipment_id, claimed.tracking_epoch_id,
    claimed.order_id, claimed.merchant_id, claimed.tracking_event_id,
    claimed.audience, claimed.notification_kind, claimed.attempt_count,
    claimed.max_attempts,
    CASE
      WHEN claimed.order_id IS NULL THEN repair.id
      ELSE NULL
    END AS repair_id
  FROM claimed
  JOIN public.shipment_tracking_events AS event
    ON event.id = claimed.tracking_event_id
  LEFT JOIN LATERAL (
    SELECT candidate.id
    FROM public.repairs AS candidate
    WHERE claimed.order_id IS NULL
      AND candidate.shipment_id = claimed.shipment_id
      AND candidate.merchant_id = claimed.merchant_id
    ORDER BY candidate.created_at DESC NULLS LAST, candidate.id DESC
    LIMIT 1
  ) AS repair ON true
  ORDER BY event.occurred_at ASC NULLS LAST,
    claimed.created_at ASC,
    claimed.id ASC;
END;
$$;

ALTER FUNCTION public.claim_shipment_tracking_notifications(integer, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_shipment_tracking_notifications(integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_shipment_tracking_notifications(integer, text)
  TO service_role;

COMMENT ON FUNCTION public.claim_shipment_tracking_notifications(integer, text) IS
  'Claims GIGL tracking notification outbox rows for the service-role worker, projecting repair_id for orderless repair-pickup shipments so the worker needs no generic repairs table access.';
