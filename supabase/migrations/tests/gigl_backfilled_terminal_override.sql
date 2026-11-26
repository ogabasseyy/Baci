BEGIN;

SELECT plan(1);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $test$
DECLARE
  v_merchant_id uuid := '63a63d85-0000-4000-8000-000000000101';
  v_case record;
  v_order_id uuid;
  v_shipment_id uuid;
  v_epoch uuid;
  v_status text;
  v_delivered_at timestamptz;
  v_location text;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (v_merchant_id, 'gigl-backfilled-terminal@example.com',
    'GIGL Backfilled Terminal', 'gigl-backfilled-terminal');

  -- A newer stored scan (progress or failed) loses to a backfilled older
  -- terminal scan of each kind (canonical rank: failed 5 < delivered 6 <
  -- cancelled/returned 7).
  FOR v_case IN
    SELECT * FROM (VALUES
      ('delivered', 'SHD', 'in_transit'),
      ('cancelled', 'MSCP', 'failed'),
      ('returned', 'SRHUB', 'out_for_delivery')
    ) AS t(terminal, raw_code, newer_status)
  LOOP
    INSERT INTO public.orders (merchant_id, order_number, total)
    VALUES (v_merchant_id, 'GIGL-BACKFILL-' || v_case.terminal, 1000)
    RETURNING id INTO v_order_id;
    INSERT INTO public.shipments (
      order_id, merchant_id, provider, tracking_number,
      sender_address, receiver_address, items
    ) VALUES (
      v_order_id, v_merchant_id, 'GIGL', 'GIGL-BACKFILL-' || v_case.terminal,
      '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
    ) RETURNING id INTO v_shipment_id;
    SELECT tracking_epoch_id INTO v_epoch
    FROM public.shipment_tracking_monitors WHERE shipment_id = v_shipment_id;
    UPDATE public.shipment_tracking_monitors
    SET locked_at = now(), locked_by = 'backfill-worker',
      notification_events_not_before = now() - interval '1 day'
    WHERE shipment_id = v_shipment_id;
    UPDATE public.shipments
    SET status = v_case.newer_status,
      current_location = 'NEWER HUB',
      tracking_events = jsonb_build_array(jsonb_build_object(
        'provider_event_key', 'newer-1', 'normalized_status', v_case.newer_status,
        'occurred_at', (now() - interval '2 hours')::text))
    WHERE id = v_shipment_id;

    PERFORM public.apply_gigl_tracking_result(
      v_shipment_id, v_epoch, 'backfill-worker', v_case.terminal, 'OLDER LOCATION',
      CASE WHEN v_case.terminal = 'delivered'
        THEN now() - interval '3 hours' END,
      -- The delivered case sends a terminal-only payload (the newer stored scan
      -- is not repeated), so delivered_at cannot lean on a newer incoming scan.
      CASE WHEN v_case.terminal = 'delivered' THEN '[]'::jsonb
        ELSE jsonb_build_array(jsonb_build_object(
          'provider_event_key', 'newer-1', 'raw_status', 'MSVC',
          'normalized_status', v_case.newer_status, 'description', 'Newer scan',
          'occurred_at', (now() - interval '2 hours')::text))
      END || jsonb_build_array(
        jsonb_build_object(
          'provider_event_key', 'terminal-1', 'raw_status', v_case.raw_code,
          'normalized_status', v_case.terminal, 'description', 'Terminal scan',
          'occurred_at', (now() - interval '3 hours')::text)
      )
    );

    SELECT status, delivered_at, current_location
    INTO v_status, v_delivered_at, v_location
    FROM public.shipments WHERE id = v_shipment_id;
    IF v_location IS DISTINCT FROM 'NEWER HUB' THEN
      RAISE EXCEPTION 'a backfilled older % scan must not overwrite the newer location, got %',
        v_case.terminal, v_location;
    END IF;
    IF v_status IS DISTINCT FROM v_case.terminal THEN
      RAISE EXCEPTION 'a backfilled older % scan must override a newer % scan, got status %',
        v_case.terminal, v_case.newer_status, v_status;
    END IF;
    IF v_case.terminal = 'delivered' AND (
      v_delivered_at IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.shipment_tracking_notification_outbox
        WHERE shipment_id = v_shipment_id AND notification_kind = 'delivered'
      )
    ) THEN
      RAISE EXCEPTION 'a backfilled older delivery must set delivered_at and queue its notification';
    END IF;
  END LOOP;

  -- A newer stored SDR fences an older backfilled terminal scan.
  INSERT INTO public.orders (merchant_id, order_number, total)
  VALUES (v_merchant_id, 'GIGL-BACKFILL-sdr', 1000) RETURNING id INTO v_order_id;
  INSERT INTO public.shipments (
    order_id, merchant_id, provider, tracking_number,
    sender_address, receiver_address, items
  ) VALUES (
    v_order_id, v_merchant_id, 'GIGL', 'GIGL-BACKFILL-sdr',
    '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
  ) RETURNING id INTO v_shipment_id;
  SELECT tracking_epoch_id INTO v_epoch
  FROM public.shipment_tracking_monitors WHERE shipment_id = v_shipment_id;
  UPDATE public.shipment_tracking_monitors
  SET locked_at = now(), locked_by = 'backfill-worker',
    notification_events_not_before = now() - interval '1 day'
  WHERE shipment_id = v_shipment_id;
  UPDATE public.shipments
  SET status = 'failed',
    tracking_events = jsonb_build_array(jsonb_build_object(
      'provider_event_key', 'sdr-1', 'raw_status', 'SDR',
      'normalized_status', 'failed',
      'occurred_at', (now() - interval '2 hours')::text))
  WHERE id = v_shipment_id;
  PERFORM public.apply_gigl_tracking_result(
    v_shipment_id, v_epoch, 'backfill-worker', 'delivered', NULL, NULL,
    jsonb_build_array(jsonb_build_object(
      'provider_event_key', 'terminal-1', 'raw_status', 'SHD',
      'normalized_status', 'delivered', 'description', 'Terminal scan',
      'occurred_at', (now() - interval '3 hours')::text))
  );
  SELECT status INTO v_status FROM public.shipments WHERE id = v_shipment_id;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'a newer stored SDR must fence an older backfilled terminal scan, got %', v_status;
  END IF;

  -- The SDR exists only as an event row (not in the JSON snapshot).
  UPDATE public.shipment_tracking_monitors
  SET locked_at = now(), locked_by = 'backfill-worker'
  WHERE shipment_id = v_shipment_id;
  UPDATE public.shipments SET tracking_events = '[]'::jsonb
  WHERE id = v_shipment_id;
  DELETE FROM public.shipment_tracking_events WHERE shipment_id = v_shipment_id;
  INSERT INTO public.shipment_tracking_events (
    shipment_id, tracking_epoch_id, tracking_number, provider,
    provider_event_key, raw_status, normalized_status, description, occurred_at
  )
  SELECT v_shipment_id, v_epoch, tracking_number, 'GIGL', 'sdr-row', 'SDR',
    'failed', 'Destroyed', now() - interval '2 hours'
  FROM public.shipments WHERE id = v_shipment_id;
  PERFORM public.apply_gigl_tracking_result(
    v_shipment_id, v_epoch, 'backfill-worker', 'delivered', NULL, NULL,
    jsonb_build_array(jsonb_build_object(
      'provider_event_key', 'terminal-2', 'raw_status', 'SHD',
      'normalized_status', 'delivered', 'description', 'Terminal scan',
      'occurred_at', (now() - interval '3 hours')::text))
  );
  SELECT status INTO v_status FROM public.shipments WHERE id = v_shipment_id;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'an SDR event row must fence a backfilled terminal scan, got %', v_status;
  END IF;
END;
$test$;

SELECT pass('backfilled older terminal scans (delivered, cancelled, returned) override newer stored scans');

SELECT * FROM finish();
ROLLBACK;
