-- GIG notification map (5/5): claim projection, stale/mute checks and dispatch re-checks.


-- A pickup-stage merchant alert is stale once the parcel has moved on, even
-- when the merchant muted the later milestone that would have superseded it.
CREATE OR REPLACE FUNCTION private.gigl_pickup_notification_stale(
  p_shipment_id uuid, p_tracking_epoch_id uuid, p_notification_kind text
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p_notification_kind IN ('pickup_assigned', 'pickup_en_route', 'pickup_delayed')
    AND EXISTS (
      SELECT 1 FROM public.shipment_tracking_events AS event
      WHERE event.shipment_id = p_shipment_id
        AND event.tracking_epoch_id = p_tracking_epoch_id
        AND event.normalized_status IN (
          'picked_up', 'in_transit', 'out_for_delivery', 'delivered',
          'failed', 'returned', 'cancelled'
        )
    );
$$;
REVOKE ALL ON FUNCTION private.gigl_pickup_notification_stale(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

-- 6. Claim projects the merchant recipients (owner + orders.fulfill staff) --------
DROP FUNCTION IF EXISTS public.claim_shipment_tracking_notifications(integer, text);

CREATE OR REPLACE FUNCTION public.claim_shipment_tracking_notifications(
  p_limit integer, p_worker_id text
)
RETURNS TABLE (
  id uuid, shipment_id uuid, tracking_epoch_id uuid, order_id uuid,
  merchant_id uuid, tracking_event_id uuid, audience text, notification_kind text,
  attempt_count integer, max_attempts integer, repair_id uuid,
  recipient_user_ids uuid[]
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
  WITH superseded AS (
    UPDATE public.shipment_tracking_notification_outbox AS outbox
    SET status = 'skipped', skipped_at = now(), updated_at = now(),
      skip_reason = 'superseded_by_newer_shipment'
    WHERE outbox.status = 'pending'
      AND outbox.audience = 'customer'
      AND outbox.notification_kind = 'cancelled'
      AND private.gigl_cancellation_superseded(outbox.shipment_id)
    RETURNING outbox.id
  ), stale_pickup AS (
    UPDATE public.shipment_tracking_notification_outbox AS outbox
    SET status = 'skipped', skipped_at = now(), updated_at = now(),
      skip_reason = 'stale_pickup_milestone'
    WHERE outbox.status = 'pending'
      AND outbox.audience = 'merchant'
      AND private.gigl_pickup_notification_stale(
        outbox.shipment_id, outbox.tracking_epoch_id, outbox.notification_kind
      )
    RETURNING outbox.id
  ), muted AS (
    UPDATE public.shipment_tracking_notification_outbox AS outbox
    SET status = 'skipped', skipped_at = now(), updated_at = now(),
      skip_reason = 'merchant_preference_off'
    WHERE outbox.status = 'pending'
      AND outbox.audience = 'merchant'
      AND NOT private.gigl_merchant_event_enabled(outbox.merchant_id, outbox.notification_kind)
    RETURNING outbox.id
  ), expired_delivery AS (
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
      AND NOT (
        outbox.audience = 'merchant'
        AND NOT private.gigl_merchant_event_enabled(outbox.merchant_id, outbox.notification_kind)
      )
      AND NOT (
        outbox.audience = 'merchant'
        AND private.gigl_pickup_notification_stale(
        outbox.shipment_id, outbox.tracking_epoch_id, outbox.notification_kind
      )
      )
      AND NOT (
        outbox.audience = 'customer' AND outbox.notification_kind = 'cancelled'
        AND private.gigl_cancellation_superseded(outbox.shipment_id)
      )
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
    END AS repair_id,
    CASE
      WHEN claimed.audience = 'merchant' THEN coalesce(recipients.user_ids, '{}'::uuid[])
      ELSE NULL
    END AS recipient_user_ids
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
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT member.user_id) AS user_ids
    FROM (
      SELECT merchant.user_id
      FROM public.merchants AS merchant
      WHERE merchant.id = claimed.merchant_id
      UNION
      SELECT staff.user_id
      FROM public.staff_members AS staff
      WHERE staff.merchant_id = claimed.merchant_id
        AND staff.status = 'active'
        AND public.check_staff_permission(
          staff.user_id, staff.merchant_id, 'orders', 'fulfill'
        )
    ) AS member
    WHERE claimed.audience = 'merchant' AND member.user_id IS NOT NULL
  ) AS recipients ON true
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
  'Claims GIGL tracking notification outbox rows for the service-role worker, projecting repair_id for orderless repair pickups and the owner plus orders.fulfill staff user ids for merchant rows.';

-- Re-check the gates when delivery starts, so a mute or a replacement shipment
-- that arrives after the claim still stops the send (the next claim then marks
-- the row skipped).
CREATE OR REPLACE FUNCTION public.begin_shipment_tracking_notification_dispatch(
  p_id uuid, p_worker_id text
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_started boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'tracking notification dispatch requires service role' USING ERRCODE = '42501';
  END IF;
  UPDATE public.shipment_tracking_notification_outbox AS outbox
  SET delivery_started_at = now(), attempt_count = outbox.attempt_count + 1,
    updated_at = now()
  WHERE outbox.id = p_id AND outbox.status = 'processing'
    AND outbox.locked_by = btrim(p_worker_id)
    AND outbox.delivery_started_at IS NULL
    AND outbox.attempt_count < outbox.max_attempts
    AND NOT (
      outbox.audience = 'merchant'
      AND (
        NOT private.gigl_merchant_event_enabled(outbox.merchant_id, outbox.notification_kind)
        OR private.gigl_pickup_notification_stale(
        outbox.shipment_id, outbox.tracking_epoch_id, outbox.notification_kind
      )
      )
    )
    AND NOT (
      outbox.audience = 'customer' AND outbox.notification_kind = 'cancelled'
      AND private.gigl_cancellation_superseded(outbox.shipment_id)
    )
  RETURNING true INTO v_started;
  RETURN coalesce(v_started, false);
END;
$$;
