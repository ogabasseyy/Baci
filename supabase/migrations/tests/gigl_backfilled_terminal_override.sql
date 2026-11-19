BEGIN;

SELECT plan(1);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $test$
DECLARE
  v_merchant_id uuid := '63a63d85-0000-4000-8000-000000000101';
  v_order_id uuid := '63a63d85-0000-4000-8000-000000000102';
  v_shipment_id uuid;
  v_epoch uuid;
  v_status text;
  v_delivered_at timestamptz;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (v_merchant_id, 'gigl-backfilled-terminal@example.com',
    'GIGL Backfilled Terminal', 'gigl-backfilled-terminal');
  INSERT INTO public.orders (id, merchant_id, order_number, total)
  VALUES (v_order_id, v_merchant_id, 'GIGL-BACKFILL-001', 1000);
  INSERT INTO public.shipments (
    order_id, merchant_id, provider, tracking_number,
    sender_address, receiver_address, items
  ) VALUES (
    v_order_id, v_merchant_id, 'GIGL', 'GIGL-BACKFILL-001',
    '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
  ) RETURNING id INTO v_shipment_id;
  SELECT tracking_epoch_id INTO v_epoch
  FROM public.shipment_tracking_monitors WHERE shipment_id = v_shipment_id;
  UPDATE public.shipment_tracking_monitors
  SET locked_at = now(), locked_by = 'backfill-worker',
    notification_events_not_before = now() - interval '1 day'
  WHERE shipment_id = v_shipment_id;

  -- An earlier poll stored a newer progress scan (MSVC, 2 hours ago).
  UPDATE public.shipments
  SET status = 'in_transit',
    tracking_events = jsonb_build_array(jsonb_build_object(
      'provider_event_key', 'msvc-1', 'normalized_status', 'in_transit',
      'occurred_at', (now() - interval '2 hours')::text))
  WHERE id = v_shipment_id;

  -- A later cumulative poll backfills an older delivered scan (3 hours ago).
  PERFORM public.apply_gigl_tracking_result(
    v_shipment_id, v_epoch, 'backfill-worker', 'delivered', NULL,
    now() - interval '3 hours',
    jsonb_build_array(
      jsonb_build_object(
        'provider_event_key', 'msvc-1', 'raw_status', 'MSVC',
        'normalized_status', 'in_transit', 'description', 'In transit',
        'occurred_at', (now() - interval '2 hours')::text),
      jsonb_build_object(
        'provider_event_key', 'shd-1', 'raw_status', 'SHD',
        'normalized_status', 'delivered', 'description', 'Delivered',
        'occurred_at', (now() - interval '3 hours')::text)
    )
  );

  SELECT status, delivered_at INTO v_status, v_delivered_at
  FROM public.shipments WHERE id = v_shipment_id;
  IF v_status IS DISTINCT FROM 'delivered' OR v_delivered_at IS NULL THEN
    RAISE EXCEPTION 'a backfilled older terminal scan must set delivered status and delivered_at, got % / %',
      v_status, v_delivered_at;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.shipment_tracking_notification_outbox
    WHERE shipment_id = v_shipment_id AND notification_kind = 'delivered'
  ) THEN
    RAISE EXCEPTION 'a backfilled older terminal scan must queue its delivery notification';
  END IF;
END;
$test$;

SELECT pass('a backfilled older terminal scan overrides a newer stored progress scan');

SELECT * FROM finish();
ROLLBACK;
