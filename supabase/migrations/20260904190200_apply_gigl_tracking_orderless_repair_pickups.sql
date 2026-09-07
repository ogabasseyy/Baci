-- Allow orderless repair-pickup GIGL monitors to apply tracking results and
-- enqueue merchant notifications without a parent order_id.
ALTER TABLE public.shipment_tracking_notification_outbox
  ALTER COLUMN order_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.apply_gigl_tracking_result(
  p_shipment_id uuid,
  p_tracking_epoch_id uuid,
  p_worker_id text,
  p_status text,
  p_current_location text,
  p_actual_delivery timestamptz,
  p_events jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order_id uuid;
  v_manual_terminal_override_at timestamptz;
  v_current_status text;
  v_previous_location text;
  v_existing_tracking_events jsonb;
  v_existing_delivered_at timestamptz;
  v_effective_status text;
  v_current_location text;
  v_latest_persisted_event_at timestamptz;
  v_latest_incoming_event_at timestamptz;
  v_latest_status_event_at timestamptz;
  v_latest_persisted_status_event_at timestamptz;
  v_should_update_location boolean := false;
  v_should_update_delivery boolean := false;
  v_inserted_events integer := 0;
  v_shipment_rows integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'GIGL tracking result application requires service role'
      USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN (
    'pending', 'booked', 'pickup_scheduled', 'picked_up', 'in_transit',
    'out_for_delivery', 'delivered', 'cancelled', 'failed', 'returned'
  ) OR jsonb_typeof(p_events) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_events) = 0 THEN
    RAISE EXCEPTION 'GIGL tracking result is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT monitor.order_id, monitor.manual_terminal_override_at
  INTO v_order_id, v_manual_terminal_override_at
  FROM public.shipment_tracking_monitors AS monitor
  WHERE monitor.shipment_id = p_shipment_id
    AND monitor.tracking_epoch_id = p_tracking_epoch_id
    AND monitor.locked_by = btrim(p_worker_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  SELECT shipment.status, shipment.current_location, shipment.tracking_events,
    shipment.delivered_at
  INTO v_current_status, v_previous_location, v_existing_tracking_events,
    v_existing_delivered_at
  FROM public.shipments AS shipment
  WHERE shipment.id = p_shipment_id
    AND shipment.order_id IS NOT DISTINCT FROM v_order_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_events) AS event(
      provider_event_key text, raw_status text, normalized_status text,
      description text, occurred_at timestamptz
    )
    WHERE nullif(btrim(event.provider_event_key), '') IS NULL
      OR nullif(btrim(event.raw_status), '') IS NULL
      OR nullif(btrim(event.description), '') IS NULL
      OR event.normalized_status NOT IN (
        'pending', 'booked', 'pickup_scheduled', 'picked_up', 'in_transit',
        'out_for_delivery', 'delivered', 'cancelled', 'failed', 'returned'
      )
      OR event.occurred_at IS NULL
  ) THEN
    RAISE EXCEPTION 'GIGL tracking events are invalid' USING ERRCODE = '22023';
  END IF;
  v_current_location := nullif(btrim(p_current_location), '');
  SELECT max(private.try_parse_gigl_tracking_timestamp(
    coalesce(entry.event->>'occurred_at', entry.event->>'timestamp')
  )) INTO v_latest_persisted_event_at
  FROM jsonb_array_elements(
    coalesce(v_existing_tracking_events, '[]'::jsonb)
  ) AS entry(event);
  SELECT max(private.try_parse_gigl_tracking_timestamp(
    coalesce(entry.event->>'occurred_at', entry.event->>'timestamp')
  )) INTO v_latest_persisted_status_event_at
  FROM jsonb_array_elements(
    coalesce(v_existing_tracking_events, '[]'::jsonb)
  ) AS entry(event)
  WHERE coalesce(
    entry.event->>'normalized_status', entry.event->>'status'
  ) = v_current_status;
  v_latest_persisted_status_event_at := coalesce(
    v_latest_persisted_status_event_at,
    v_latest_persisted_event_at
  );
  SELECT max(private.try_parse_gigl_tracking_timestamp(
    coalesce(entry.event->>'occurred_at', entry.event->>'timestamp')
  )) INTO v_latest_incoming_event_at
  FROM jsonb_array_elements(p_events) AS entry(event);
  SELECT max(private.try_parse_gigl_tracking_timestamp(
    coalesce(entry.event->>'occurred_at', entry.event->>'timestamp')
  )) INTO v_latest_status_event_at
  FROM jsonb_array_elements(p_events) AS entry(event)
  WHERE entry.event->>'normalized_status' = p_status;

  v_effective_status := CASE
    WHEN v_manual_terminal_override_at IS NOT NULL
      AND v_latest_incoming_event_at <= v_manual_terminal_override_at
      THEN v_current_status
    WHEN v_current_status IN ('delivered', 'cancelled', 'returned')
      AND p_status NOT IN ('cancelled', 'failed', 'returned')
      THEN v_current_status
    WHEN v_current_status IN ('delivered', 'cancelled', 'returned')
      AND p_status IN ('cancelled', 'failed', 'returned')
      AND (
        v_latest_status_event_at IS NULL
        OR (
          v_latest_persisted_status_event_at IS NOT NULL
          AND v_latest_status_event_at <= v_latest_persisted_status_event_at
        )
      )
      THEN v_current_status
    WHEN v_current_status IS NOT NULL
      AND v_latest_persisted_event_at IS NOT NULL
      AND v_latest_status_event_at IS NOT NULL
      AND v_latest_status_event_at < v_latest_persisted_status_event_at
      THEN v_current_status
    WHEN private.gigl_tracking_status_rank(p_status)
      < private.gigl_tracking_status_rank(coalesce(v_current_status, 'pending'))
      THEN v_current_status
    ELSE p_status
  END;
  v_should_update_location := v_current_location IS NOT NULL
    AND (
      v_latest_persisted_event_at IS NULL
      OR (
        v_latest_incoming_event_at IS NOT NULL
        AND v_latest_incoming_event_at >= v_latest_persisted_event_at
      )
    );
  v_should_update_delivery := p_actual_delivery IS NOT NULL
    AND (
      v_existing_delivered_at IS NULL
      OR p_actual_delivery >= v_existing_delivered_at
    )
    AND (
      v_latest_persisted_event_at IS NULL
      OR v_latest_incoming_event_at IS NULL
      OR v_latest_incoming_event_at >= v_latest_persisted_event_at
    );

  WITH inserted_events AS (
    INSERT INTO public.shipment_tracking_events (
      shipment_id, tracking_epoch_id, tracking_number, provider,
      provider_event_key, provider_event_id, raw_status, normalized_status,
      description, location, occurred_at
    )
    SELECT
      p_shipment_id, p_tracking_epoch_id, monitor.tracking_number, 'GIGL',
      event.provider_event_key, nullif(event.provider_event_id, ''),
      event.raw_status, event.normalized_status, event.description,
      nullif(event.location, ''), event.occurred_at
    FROM public.shipment_tracking_monitors AS monitor
    CROSS JOIN LATERAL jsonb_to_recordset(p_events) AS event(
      provider_event_key text, provider_event_id text, raw_status text,
      normalized_status text, description text, location text, occurred_at timestamptz
    )
    WHERE monitor.shipment_id = p_shipment_id
      AND monitor.tracking_epoch_id = p_tracking_epoch_id
      AND monitor.locked_by = btrim(p_worker_id)
    ON CONFLICT (shipment_id, tracking_epoch_id, provider_event_key) DO NOTHING
    RETURNING id, shipment_id, tracking_epoch_id, raw_status, normalized_status,
      occurred_at
  ), queued_notifications AS (
    INSERT INTO public.shipment_tracking_notification_outbox (
      shipment_id, tracking_epoch_id, order_id, merchant_id, tracking_event_id,
      audience, notification_kind
    )
    SELECT event.shipment_id, event.tracking_epoch_id, shipment.order_id,
      shipment.merchant_id, event.id, policy.audience, policy.notification_kind
    FROM inserted_events AS event
    JOIN public.shipments AS shipment ON shipment.id = p_shipment_id
    JOIN public.shipment_tracking_monitors AS monitor ON monitor.shipment_id = p_shipment_id
      AND monitor.tracking_epoch_id = p_tracking_epoch_id
    JOIN private.gigl_tracking_notification_policy AS policy ON (
      policy.raw_status = upper(event.raw_status)
      OR (
        policy.raw_status IS NULL
        AND policy.normalized_status = event.normalized_status
        AND NOT EXISTS (
          SELECT 1 FROM private.gigl_tracking_notification_policy AS raw_policy
          WHERE raw_policy.raw_status = upper(event.raw_status)
        )
      )
    )
    WHERE event.occurred_at >= monitor.notification_events_not_before
      AND event.normalized_status = v_effective_status
      AND (shipment.order_id IS NOT NULL OR policy.audience = 'merchant')
    ON CONFLICT (
      shipment_id, tracking_epoch_id, tracking_event_id, audience, notification_kind
    )
      DO NOTHING
      RETURNING id
  )
  SELECT count(*) INTO v_inserted_events FROM inserted_events;
  UPDATE public.shipments AS shipment
  SET status = v_effective_status,
    current_location = CASE
      WHEN v_should_update_location THEN v_current_location
      ELSE coalesce(v_previous_location, shipment.current_location)
    END,
    delivered_at = CASE
      WHEN v_should_update_delivery THEN p_actual_delivery
      ELSE shipment.delivered_at
    END,
    tracking_events = (
      WITH merged_entries AS (
        SELECT
          entry.event,
          identity.event_key,
          private.try_parse_gigl_tracking_timestamp(
            coalesce(entry.event->>'occurred_at', entry.event->>'timestamp')
          ) AS occurred_at
        FROM jsonb_array_elements(
          coalesce(shipment.tracking_events, '[]'::jsonb) || p_events
        ) AS entry(event)
        CROSS JOIN LATERAL (
          SELECT coalesce(
            nullif(btrim(entry.event->>'provider_event_key'), ''),
            nullif(btrim(entry.event->>'providerEventKey'), ''),
            nullif(btrim(entry.event->>'provider_event_id'), ''),
            nullif(btrim(entry.event->>'providerEventId'), ''),
            nullif(btrim(entry.event->>'occurred_at'), ''),
            nullif(btrim(entry.event->>'timestamp'), ''),
            entry.event::text
          ) AS event_key
        ) AS identity
      ), deduplicated_entries AS (
        SELECT DISTINCT ON (entry.event_key) entry.event, entry.occurred_at
        FROM merged_entries AS entry
        ORDER BY entry.event_key, entry.occurred_at ASC NULLS LAST
      )
      SELECT coalesce(
        jsonb_agg(entry.event ORDER BY entry.occurred_at ASC NULLS LAST),
        '[]'::jsonb
      )
      FROM deduplicated_entries AS entry
    ),
    last_tracked_at = now(),
    updated_at = now()
  WHERE shipment.id = p_shipment_id
    AND shipment.order_id IS NOT DISTINCT FROM v_order_id;

  GET DIAGNOSTICS v_shipment_rows = ROW_COUNT;
  IF v_shipment_rows <> 1 THEN
    RAISE EXCEPTION 'GIGL tracking shipment identity changed'
      USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.shipment_tracking_monitors AS monitor
  SET state = CASE WHEN v_effective_status IN ('delivered', 'cancelled', 'returned')
      THEN 'terminal' ELSE 'active' END,
    next_poll_at = CASE WHEN v_effective_status IN ('delivered', 'cancelled', 'returned')
      THEN NULL ELSE now() + interval '15 minutes' END,
    stopped_at = CASE WHEN v_effective_status IN ('delivered', 'cancelled', 'returned')
      THEN now() ELSE NULL END,
    manual_terminal_override_at = CASE
      WHEN v_manual_terminal_override_at IS NOT NULL
        AND v_latest_incoming_event_at > v_manual_terminal_override_at
        THEN NULL
      ELSE monitor.manual_terminal_override_at
    END,
    last_polled_at = now(),
    last_event_at = CASE WHEN v_inserted_events > 0 THEN now() ELSE monitor.last_event_at END,
    unchanged_poll_count = CASE WHEN v_inserted_events > 0 THEN 0 ELSE monitor.unchanged_poll_count + 1 END,
    consecutive_failures = 0, last_error = NULL, locked_at = NULL, locked_by = NULL,
    updated_at = now()
  WHERE monitor.shipment_id = p_shipment_id
    AND monitor.tracking_epoch_id = p_tracking_epoch_id
    AND monitor.locked_by = btrim(p_worker_id);

  RETURN true;
END;
$$;

ALTER FUNCTION public.apply_gigl_tracking_result(uuid, uuid, text, text, text, timestamptz, jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.apply_gigl_tracking_result(uuid, uuid, text, text, text, timestamptz, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_gigl_tracking_result(uuid, uuid, text, text, text, timestamptz, jsonb)
  TO service_role;
