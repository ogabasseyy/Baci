-- Repair active GIG shipments whose pickup-run "SHIPMENT ENROUTE DELIVERY"
-- (MSHC) scan was persisted as out_for_delivery before the normalizer fix.
-- Only MSHC scans that precede every other movement scan are touched, and only
-- shipments with no genuine out_for_delivery event; terminal shipments and
-- notification history are left alone. Idempotent: a second run matches nothing.
-- Residual scope (by design): histories with a terminal event or an SDR scan,
-- an MSHC tied to a movement scan's timestamp, and terminal shipments are not
-- rewritten. The JSON patch joins on (shipment, key); fixed_events holds only
-- active-epoch rows, one per key, so it cannot fan out; status candidates are
-- limited to the active epoch.
CREATE OR REPLACE FUNCTION private.repair_gigl_first_mile_out_for_delivery()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_repaired integer;
BEGIN
  -- Same order as apply_gigl_tracking_result (monitor, then shipment), taken
  -- before the statement reads events, so a concurrent poll finishes first and
  -- the repair never overwrites a newer status from a stale snapshot.
  PERFORM 1 FROM public.shipment_tracking_monitors AS monitor
  WHERE monitor.state = 'active'
    AND EXISTS (SELECT 1 FROM public.shipments AS shipment
      WHERE shipment.id = monitor.shipment_id AND shipment.status = 'out_for_delivery')
  ORDER BY monitor.shipment_id FOR UPDATE;
  PERFORM 1 FROM public.shipments AS shipment
  WHERE shipment.status = 'out_for_delivery'
    AND EXISTS (SELECT 1 FROM public.shipment_tracking_monitors AS monitor
      WHERE monitor.shipment_id = shipment.id AND monitor.state = 'active')
  ORDER BY shipment.id FOR UPDATE;
  WITH movement AS (
    SELECT event.shipment_id, event.tracking_epoch_id,
      min(event.occurred_at) AS first_movement_at
    FROM public.shipment_tracking_events AS event
    WHERE event.provider = 'GIGL'
      AND (
        event.normalized_status IN ('in_transit', 'failed', 'delivered', 'returned', 'cancelled')
        OR (event.normalized_status = 'out_for_delivery' AND upper(event.raw_status) <> 'MSHC')
      )
    GROUP BY event.shipment_id, event.tracking_epoch_id
  ), first_mile AS (
    SELECT event.id, event.shipment_id, event.tracking_epoch_id, event.provider_event_key, event.occurred_at,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.shipment_tracking_events AS pickup
        WHERE pickup.shipment_id = event.shipment_id
          AND pickup.tracking_epoch_id = event.tracking_epoch_id
          AND pickup.normalized_status = 'picked_up'
          AND pickup.occurred_at <= event.occurred_at
      ) THEN 'picked_up' ELSE 'pickup_scheduled' END AS fixed_status
    FROM public.shipment_tracking_events AS event
    JOIN public.shipments AS shipment ON shipment.id = event.shipment_id
    JOIN public.shipment_tracking_monitors AS monitor
      ON monitor.shipment_id = event.shipment_id
      AND monitor.tracking_epoch_id = event.tracking_epoch_id
      AND monitor.state = 'active'
    LEFT JOIN movement ON movement.shipment_id = event.shipment_id
      AND movement.tracking_epoch_id = event.tracking_epoch_id
    WHERE event.provider = 'GIGL'
      AND upper(event.raw_status) = 'MSHC'
      AND event.normalized_status = 'out_for_delivery'
      AND shipment.status = 'out_for_delivery'
      AND (movement.first_movement_at IS NULL OR event.occurred_at < movement.first_movement_at)
  ), repairable AS (
    SELECT fm.shipment_id FROM first_mile AS fm
    GROUP BY fm.shipment_id, fm.tracking_epoch_id
    HAVING NOT EXISTS (
      SELECT 1 FROM public.shipment_tracking_events AS genuine
      WHERE genuine.shipment_id = fm.shipment_id
        AND genuine.normalized_status = 'out_for_delivery'
        AND genuine.tracking_epoch_id = fm.tracking_epoch_id
        AND genuine.id NOT IN (SELECT id FROM first_mile)
    )
    -- Out of scope by design: histories with a terminal event (monitor state,
    -- delivered_at and refunds belong to the apply function) or an SDR (its
    -- fence outlives later scans); the normal poller owns those.
    AND NOT EXISTS (
      SELECT 1 FROM public.shipment_tracking_events AS special
      WHERE special.shipment_id = fm.shipment_id
        AND special.tracking_epoch_id = fm.tracking_epoch_id
        AND (
          special.normalized_status IN ('delivered', 'cancelled', 'returned')
          OR upper(special.raw_status) = 'SDR'
        )
    )
  ), fixed_events AS (
    UPDATE public.shipment_tracking_events AS event
    SET normalized_status = fm.fixed_status
    FROM first_mile AS fm
    WHERE event.id = fm.id AND fm.shipment_id IN (SELECT shipment_id FROM repairable)
    RETURNING event.shipment_id, event.tracking_epoch_id, event.provider_event_key, event.normalized_status
  ), deleted_outbox AS (
    -- A pending, unstarted or skipped out_for_delivery update for a demoted scan must not
    -- go out, and (never sent) it must not keep occupying the milestone identity
    -- a later genuine out-for-delivery scan needs. Sent history is kept.
    DELETE FROM public.shipment_tracking_notification_outbox AS outbox
    USING first_mile AS fm
    WHERE outbox.tracking_event_id = fm.id
      AND fm.shipment_id IN (SELECT shipment_id FROM repairable)
      AND outbox.notification_kind = 'out_for_delivery'
      AND (
        -- 'skipped' covers a muted merchant notice (out_for_delivery is off by
        -- default), which was never sent but still holds the identity.
        outbox.status = 'pending'
        OR (outbox.status IN ('processing', 'skipped')
          AND outbox.delivery_started_at IS NULL)
      )
    RETURNING outbox.id
  ), new_status AS (
    SELECT shipment.id AS shipment_id,
      (SELECT candidate.status FROM (
         SELECT event.normalized_status AS status, event.occurred_at
         FROM public.shipment_tracking_events AS event
         WHERE event.shipment_id = shipment.id
           -- Unrecognised scans are stored as pending and do not set the status.
           AND event.normalized_status <> 'pending'
           AND event.tracking_epoch_id = (
           SELECT monitor.tracking_epoch_id
           FROM public.shipment_tracking_monitors AS monitor
           WHERE monitor.shipment_id = shipment.id AND monitor.state = 'active'
           LIMIT 1)
         AND event.id NOT IN (SELECT id FROM first_mile WHERE shipment_id = shipment.id)
         UNION ALL
         SELECT fm.fixed_status, fm.occurred_at FROM first_mile AS fm WHERE fm.shipment_id = shipment.id
       ) AS candidate
       -- Latest remaining event wins (a failed scan after the demoted MSHC
       -- stays failed); ties fall back to the lifecycle rank, failed = 5.
       ORDER BY candidate.occurred_at DESC,
         CASE candidate.status
           WHEN 'pending' THEN 0 WHEN 'booked' THEN 1 WHEN 'pickup_scheduled' THEN 2
           WHEN 'picked_up' THEN 3 WHEN 'in_transit' THEN 4
           WHEN 'out_for_delivery' THEN 5 WHEN 'failed' THEN 5 ELSE 6 END DESC
       LIMIT 1) AS status
    FROM public.shipments AS shipment
    WHERE shipment.id IN (SELECT shipment_id FROM repairable)
  )
  UPDATE public.shipments AS shipment
  SET status = new_status.status,
    -- Same as the apply function: without it the monitor trigger reads this as
    -- a manual terminal override.
    last_tracked_at = now(),
    tracking_events = coalesce((
      SELECT jsonb_agg(
        CASE WHEN fixed.provider_event_key IS NULL THEN entry.event
          -- Both snapshot shapes: apply-function events (provider_event_key,
          -- normalized_status) and track-route snapshots (providerEventKey, status).
          ELSE (
            CASE WHEN entry.event ? 'status'
              THEN jsonb_set(entry.event, '{status}', to_jsonb(fixed.normalized_status))
              ELSE entry.event
            END
          ) || CASE
            WHEN entry.event ? 'normalized_status' OR NOT (entry.event ? 'status')
              THEN jsonb_build_object('normalized_status', fixed.normalized_status)
            ELSE '{}'::jsonb
          END
        END
        ORDER BY entry.ordinality
      )
      FROM jsonb_array_elements(coalesce(shipment.tracking_events, '[]'::jsonb))
        WITH ORDINALITY AS entry(event, ordinality)
      LEFT JOIN fixed_events AS fixed
        ON fixed.shipment_id = shipment.id
        AND fixed.provider_event_key = coalesce(
          entry.event->>'provider_event_key', entry.event->>'providerEventKey'
        )
        -- A key reused in another epoch cannot be told apart in the JSON: skip it.
        AND NOT EXISTS (
          SELECT 1 FROM public.shipment_tracking_events AS other
          WHERE other.shipment_id = fixed.shipment_id
            AND other.provider_event_key = fixed.provider_event_key
            AND other.tracking_epoch_id <> fixed.tracking_epoch_id)
    ), shipment.tracking_events),
    updated_at = now()
  FROM new_status
  WHERE shipment.id = new_status.shipment_id;
  GET DIAGNOSTICS v_repaired = ROW_COUNT;
  RETURN v_repaired;
END;
$fn$;

ALTER FUNCTION private.repair_gigl_first_mile_out_for_delivery() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.repair_gigl_first_mile_out_for_delivery()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT private.repair_gigl_first_mile_out_for_delivery();
