-- Repair active GIG shipments whose pickup-run "SHIPMENT ENROUTE DELIVERY"
-- (MSHC) scan was persisted as out_for_delivery before the normalizer fix.
-- Only MSHC scans that precede every other movement scan are touched, and only
-- shipments with no genuine out_for_delivery event; terminal shipments and
-- notification history are left alone. Idempotent: a second run matches nothing.
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
  SELECT event.id, event.shipment_id, event.provider_event_key,
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
  GROUP BY fm.shipment_id
  HAVING NOT EXISTS (
    SELECT 1 FROM public.shipment_tracking_events AS genuine
    WHERE genuine.shipment_id = fm.shipment_id
      AND genuine.normalized_status = 'out_for_delivery'
      AND genuine.id NOT IN (SELECT id FROM first_mile)
  )
), fixed_events AS (
  UPDATE public.shipment_tracking_events AS event
  SET normalized_status = fm.fixed_status
  FROM first_mile AS fm
  WHERE event.id = fm.id AND fm.shipment_id IN (SELECT shipment_id FROM repairable)
  RETURNING event.shipment_id, event.provider_event_key, event.normalized_status
), new_status AS (
  SELECT shipment.id AS shipment_id,
    (SELECT candidate.status FROM (
       SELECT event.normalized_status AS status
       FROM public.shipment_tracking_events AS event
       WHERE event.shipment_id = shipment.id
         AND event.id NOT IN (SELECT id FROM first_mile WHERE shipment_id = shipment.id)
       UNION ALL
       SELECT fm.fixed_status FROM first_mile AS fm WHERE fm.shipment_id = shipment.id
     ) AS candidate
     ORDER BY private.gigl_tracking_status_rank(candidate.status) DESC
     LIMIT 1) AS status
  FROM public.shipments AS shipment
  WHERE shipment.id IN (SELECT shipment_id FROM repairable)
)
UPDATE public.shipments AS shipment
SET status = new_status.status,
  tracking_events = coalesce((
    SELECT jsonb_agg(
      CASE WHEN fixed.provider_event_key IS NULL THEN entry.event
        ELSE jsonb_set(entry.event, '{normalized_status}', to_jsonb(fixed.normalized_status))
      END
      ORDER BY entry.ordinality
    )
    FROM jsonb_array_elements(coalesce(shipment.tracking_events, '[]'::jsonb))
      WITH ORDINALITY AS entry(event, ordinality)
    LEFT JOIN fixed_events AS fixed
      ON fixed.shipment_id = shipment.id
      AND fixed.provider_event_key = entry.event->>'provider_event_key'
  ), shipment.tracking_events),
  updated_at = now()
FROM new_status
WHERE shipment.id = new_status.shipment_id;
