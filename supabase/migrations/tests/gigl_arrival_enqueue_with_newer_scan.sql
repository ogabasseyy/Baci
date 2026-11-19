BEGIN;

SELECT plan(1);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $test$
DECLARE
  v_merchant_id uuid := '63a63d83-0000-4000-8000-000000000101';
  v_order_id uuid := '63a63d83-0000-4000-8000-000000000102';
  v_shipment_id uuid;
  v_epoch uuid;
  v_status text;
  v_kinds text[];
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (v_merchant_id, 'gigl-arrival-enqueue@example.com',
    'GIGL Arrival Enqueue', 'gigl-arrival-enqueue');
  INSERT INTO public.orders (id, merchant_id, order_number, total)
  VALUES (v_order_id, v_merchant_id, 'GIGL-ARRIVAL-ENQUEUE-001', 1000);
  INSERT INTO public.shipments (
    order_id, merchant_id, provider, tracking_number,
    sender_address, receiver_address, items
  ) VALUES (
    v_order_id, v_merchant_id, 'GIGL', 'GIGL-ARRIVAL-ENQUEUE-001',
    '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
  ) RETURNING id INTO v_shipment_id;
  SELECT tracking_epoch_id INTO v_epoch
  FROM public.shipment_tracking_monitors WHERE shipment_id = v_shipment_id;
  UPDATE public.shipment_tracking_monitors
  SET locked_at = now(), locked_by = 'arrival-worker',
    notification_events_not_before = now() - interval '1 day'
  WHERE shipment_id = v_shipment_id;

  -- One poll: the synthetic arrival plus a newer delivery run (MSHC).
  PERFORM public.apply_gigl_tracking_result(
    v_shipment_id, v_epoch, 'arrival-worker', 'out_for_delivery', NULL, NULL,
    jsonb_build_array(
      jsonb_build_object(
        'provider_event_key', 'arrival-1', 'raw_status', 'ARRIVED IN DESTINATION CITY',
        'normalized_status', 'in_transit', 'description', 'Arrived in city',
        'occurred_at', (now() - interval '2 hours')::text),
      jsonb_build_object(
        'provider_event_key', 'mshc-1', 'raw_status', 'MSHC',
        'normalized_status', 'out_for_delivery', 'description', 'Out for delivery',
        'occurred_at', (now() - interval '1 hour')::text)
    )
  );

  SELECT status INTO v_status FROM public.shipments WHERE id = v_shipment_id;
  SELECT array_agg(notification_kind ORDER BY notification_kind) INTO v_kinds
  FROM public.shipment_tracking_notification_outbox
  WHERE shipment_id = v_shipment_id AND audience = 'customer';
  IF v_status IS DISTINCT FROM 'out_for_delivery'
    OR v_kinds IS DISTINCT FROM ARRAY['out_for_delivery'] THEN
    RAISE EXCEPTION 'arrival plus a newer delivery run must leave the customer one current update, got % / %',
      v_status, v_kinds;
  END IF;
END;
$test$;

SELECT pass('arrival sharing a poll with a newer scan is superseded, not lost or duplicated');

SELECT * FROM finish();
ROLLBACK;
