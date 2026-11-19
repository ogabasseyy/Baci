-- Section 4 of gigl_notification_map.sql (\ir part).
-- 4. Customer cancellation only without a newer live shipment -------------------------
DO $cancel$
DECLARE
  f gigl_map_fixture%ROWTYPE;
  v_new_shipment uuid;
BEGIN
  SELECT * INTO f FROM gigl_map_fixture;
  -- A shipment-only cancellation (order not cancelled) never alerts the
  -- customer (20261114183000).
  INSERT INTO public.shipment_tracking_notification_outbox (
    shipment_id, tracking_epoch_id, order_id, merchant_id, tracking_event_id,
    audience, notification_kind
  ) VALUES (
    f.shipment_id, f.epoch_id, f.order_id, f.merchant_id, f.event_id,
    'customer', 'cancelled'
  );
  IF (SELECT skip_reason FROM public.shipment_tracking_notification_outbox
      WHERE shipment_id = f.shipment_id AND audience = 'customer'
        AND notification_kind = 'cancelled') IS DISTINCT FROM 'shipment_only_cancellation' THEN
    RAISE EXCEPTION 'a shipment-only cancellation must not notify the customer';
  END IF;
  DELETE FROM public.shipment_tracking_notification_outbox
  WHERE shipment_id = f.shipment_id AND audience = 'customer'
    AND notification_kind = 'cancelled';
  -- The merchant is still told: with the order not cancelled and no
  -- replacement shipment, the cancellation reopened the order for rebooking.
  INSERT INTO public.shipment_tracking_notification_outbox (
    shipment_id, tracking_epoch_id, order_id, merchant_id, tracking_event_id,
    audience, notification_kind
  ) VALUES (
    f.shipment_id, f.epoch_id, f.order_id, f.merchant_id, f.event_id,
    'merchant', 'cancelled'
  );
  IF (SELECT status FROM public.shipment_tracking_notification_outbox
      WHERE shipment_id = f.shipment_id AND audience = 'merchant'
        AND notification_kind = 'cancelled') IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'a shipment-only cancellation must alert the merchant to rebook';
  END IF;
  DELETE FROM public.shipment_tracking_notification_outbox
  WHERE shipment_id = f.shipment_id AND audience = 'merchant'
    AND notification_kind = 'cancelled';
  -- The rest of this block covers a cancelled order.
  UPDATE public.orders SET cancelled_at = now() WHERE id = f.order_id;
  INSERT INTO public.shipment_tracking_notification_outbox (
    shipment_id, tracking_epoch_id, order_id, merchant_id, tracking_event_id,
    audience, notification_kind
  ) VALUES (
    f.shipment_id, f.epoch_id, f.order_id, f.merchant_id, f.event_id,
    'customer', 'cancelled'
  );
  IF (SELECT status FROM public.shipment_tracking_notification_outbox
      WHERE shipment_id = f.shipment_id AND audience = 'customer'
        AND notification_kind = 'cancelled') <> 'pending' THEN
    RAISE EXCEPTION 'cancellation with no replacement must notify the customer';
  END IF;
  DELETE FROM public.shipment_tracking_notification_outbox
  WHERE shipment_id = f.shipment_id AND audience = 'customer'
    AND notification_kind = 'cancelled';
  UPDATE public.shipments SET status = 'cancelled' WHERE id = f.shipment_id;
  INSERT INTO public.shipments (
    order_id, merchant_id, provider, tracking_number,
    sender_address, receiver_address, items, created_at, funding_source
  ) VALUES (
    f.order_id, f.merchant_id, 'GIGL', 'GIGL-MAP-002',
    '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, now() + interval '1 minute',
    'external_manual'
  ) RETURNING id INTO v_new_shipment;
  INSERT INTO public.shipment_tracking_notification_outbox (
    shipment_id, tracking_epoch_id, order_id, merchant_id, tracking_event_id,
    audience, notification_kind
  ) VALUES
    (f.shipment_id, f.epoch_id, f.order_id, f.merchant_id, f.event_id, 'customer', 'cancelled'),
    (f.shipment_id, f.epoch_id, f.order_id, f.merchant_id, f.event_id, 'merchant', 'cancelled');
  IF (SELECT count(*) FROM public.shipment_tracking_notification_outbox
      WHERE shipment_id = f.shipment_id
        AND notification_kind = 'cancelled'
        AND skip_reason = 'superseded_by_newer_shipment') <> 2 THEN
    RAISE EXCEPTION 'cancellation must be dropped for both customer and merchant when a newer live shipment exists';
  END IF;
  IF (SELECT count(*) FROM public.shipment_tracking_notification_outbox
      WHERE shipment_id = v_new_shipment
        AND notification_kind = 'waybill_changed') <> 2 THEN
    RAISE EXCEPTION 'a replacement waybill must alert both the merchant and the customer';
  END IF;
  -- The booked GIG replacement keeps the order out of the early-shipped path.
  UPDATE public.shipments SET status = 'failed' WHERE id = v_new_shipment;
  DELETE FROM public.shipment_tracking_notification_outbox
  WHERE shipment_id = f.shipment_id AND audience = 'customer'
    AND notification_kind = 'cancelled';
  INSERT INTO public.shipment_tracking_notification_outbox (
    shipment_id, tracking_epoch_id, order_id, merchant_id, tracking_event_id,
    audience, notification_kind
  ) VALUES (
    f.shipment_id, f.epoch_id, f.order_id, f.merchant_id, f.event_id,
    'customer', 'cancelled'
  );
  IF (SELECT status FROM public.shipment_tracking_notification_outbox
      WHERE shipment_id = f.shipment_id AND audience = 'customer'
        AND notification_kind = 'cancelled') <> 'pending' THEN
    RAISE EXCEPTION 'a failed replacement is not live: the cancellation must notify';
  END IF;
  UPDATE public.shipments SET status = 'cancelled' WHERE id = v_new_shipment;
  UPDATE public.orders SET cancelled_at = NULL WHERE id = f.order_id;
END;
$cancel$;

-- 4b. The merchant rebooking alert and the order reopen share one recency rule
-- (tracking_timeline_generation, 20261114183000), whatever created_at says.
-- Like the tracking apply path, the notification row is written first (the
-- gate) and the status write follows (the order sync).
CREATE FUNCTION pg_temp.map_seed_shipment(
  p_order uuid, p_merchant uuid, p_waybill text, p_created_at timestamptz
)
RETURNS uuid[]
LANGUAGE plpgsql
AS $seed$
DECLARE
  v_shipment uuid;
  v_epoch uuid;
  v_event uuid;
BEGIN
  INSERT INTO public.shipments (
    order_id, merchant_id, provider, tracking_number,
    sender_address, receiver_address, items, created_at, funding_source
  ) VALUES (
    p_order, p_merchant, 'GIGL', p_waybill,
    '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, p_created_at, 'external_manual'
  ) RETURNING id INTO v_shipment;
  SELECT tracking_epoch_id INTO v_epoch
  FROM public.shipment_tracking_monitors WHERE shipment_id = v_shipment;
  INSERT INTO public.shipment_tracking_events (
    shipment_id, tracking_epoch_id, tracking_number, provider,
    provider_event_key, raw_status, normalized_status, description, occurred_at
  ) VALUES (
    v_shipment, v_epoch, p_waybill, 'GIGL', 'event-' || p_waybill, 'SSC',
    'cancelled', 'Cancelled', now()
  ) RETURNING id INTO v_event;
  RETURN ARRAY[v_shipment, v_epoch, v_event];
END;
$seed$;

CREATE FUNCTION pg_temp.map_cancel_shipment(
  p_ids uuid[], p_order uuid, p_merchant uuid
)
RETURNS text
LANGUAGE plpgsql
AS $cancel_shipment$
DECLARE
  v_state text;
BEGIN
  INSERT INTO public.shipment_tracking_notification_outbox (
    shipment_id, tracking_epoch_id, order_id, merchant_id, tracking_event_id,
    audience, notification_kind
  ) VALUES (
    p_ids[1], p_ids[2], p_order, p_merchant, p_ids[3], 'merchant', 'cancelled'
  );
  UPDATE public.shipments SET status = 'cancelled' WHERE id = p_ids[1];
  SELECT outbox.status || '/' || coalesce(outbox.skip_reason, '') INTO v_state
  FROM public.shipment_tracking_notification_outbox AS outbox
  WHERE outbox.shipment_id = p_ids[1] AND outbox.audience = 'merchant'
    AND outbox.notification_kind = 'cancelled';
  RETURN v_state;
END;
$cancel_shipment$;

DO $rebook$
DECLARE
  f gigl_map_fixture%ROWTYPE;
  v_order uuid;
  v_first uuid[];
  v_second uuid[];
  v_cycle uuid;
BEGIN
  SELECT * INTO f FROM gigl_map_fixture;

  -- A replacement that is newer by generation but older by created_at: the
  -- order sync ignores the stale cancellation, so the merchant is not told to
  -- rebook (the created_at rule alone would still alert).
  v_order := '7a1c0000-0000-4000-8000-000000000011';
  INSERT INTO public.orders (id, merchant_id, order_number, total, shipping_status)
  VALUES (v_order, f.merchant_id, 'GIGL-MAP-011', 1000, 'processing');
  v_first := pg_temp.map_seed_shipment(v_order, f.merchant_id, 'GIGL-MAP-011A', now());
  v_second := pg_temp.map_seed_shipment(
    v_order, f.merchant_id, 'GIGL-MAP-011B', now() - interval '1 day'
  );
  IF private.gigl_cancellation_superseded(v_first[1])
    OR NOT private.gigl_has_newer_order_shipment(
      v_order, f.merchant_id,
      (SELECT tracking_timeline_generation FROM public.shipments WHERE id = v_first[1])
    )
  THEN
    RAISE EXCEPTION 'fixture: generation must disagree with created_at (backdated replacement)';
  END IF;
  UPDATE public.orders SET shipment_id = v_first[1] WHERE id = v_order;
  IF pg_temp.map_cancel_shipment(v_first, v_order, f.merchant_id)
       IS DISTINCT FROM 'skipped/superseded_by_newer_shipment' THEN
    RAISE EXCEPTION 'a stale cancellation (newer generation) must not alert the merchant to rebook';
  END IF;
  IF (SELECT shipment_id FROM public.orders WHERE id = v_order)
       IS DISTINCT FROM v_first[1] THEN
    RAISE EXCEPTION 'a stale cancellation (newer generation) must not reopen the order';
  END IF;

  -- The newest shipment cancels while another shipment has a later created_at:
  -- the order sync reopens the order, so the merchant must be told to rebook
  -- (the created_at rule alone would silence the alert).
  v_order := '7a1c0000-0000-4000-8000-000000000012';
  INSERT INTO public.orders (id, merchant_id, order_number, total, shipping_status)
  VALUES (v_order, f.merchant_id, 'GIGL-MAP-012', 1000, 'processing');
  v_second := pg_temp.map_seed_shipment(
    v_order, f.merchant_id, 'GIGL-MAP-012A', now() + interval '1 day'
  );
  v_first := pg_temp.map_seed_shipment(v_order, f.merchant_id, 'GIGL-MAP-012B', now());
  IF NOT private.gigl_cancellation_superseded(v_first[1])
    OR private.gigl_has_newer_order_shipment(
      v_order, f.merchant_id,
      (SELECT tracking_timeline_generation FROM public.shipments WHERE id = v_first[1])
    )
  THEN
    RAISE EXCEPTION 'fixture: generation must disagree with created_at (later created_at)';
  END IF;
  UPDATE public.orders SET shipment_id = v_first[1] WHERE id = v_order;
  IF pg_temp.map_cancel_shipment(v_first, v_order, f.merchant_id)
       IS DISTINCT FROM 'pending/' THEN
    RAISE EXCEPTION 'a cancellation that reopens the order must alert the merchant to rebook';
  END IF;
  IF (SELECT shipment_id FROM public.orders WHERE id = v_order) IS NOT NULL THEN
    RAISE EXCEPTION 'the newest shipment cancelling must reopen the order';
  END IF;

  -- bugfix: a repeat cancellation of an already reopened order (processing,
  -- unlinked) must keep the order's notification cycle.
  v_order := '7a1c0000-0000-4000-8000-000000000013';
  INSERT INTO public.orders (id, merchant_id, order_number, total, shipping_status)
  VALUES (v_order, f.merchant_id, 'GIGL-MAP-013', 1000, 'processing');
  v_first := pg_temp.map_seed_shipment(v_order, f.merchant_id, 'GIGL-MAP-013A', now());
  UPDATE public.orders SET shipment_id = v_first[1] WHERE id = v_order;
  v_cycle := (SELECT fulfillment_notification_cycle_id FROM public.orders WHERE id = v_order);
  PERFORM pg_temp.map_cancel_shipment(v_first, v_order, f.merchant_id);
  IF (SELECT shipment_id FROM public.orders WHERE id = v_order) IS NOT NULL
    OR (SELECT fulfillment_notification_cycle_id FROM public.orders WHERE id = v_order)
      IS NOT DISTINCT FROM v_cycle
  THEN
    RAISE EXCEPTION 'the first cancellation must reopen the order with a new notification cycle';
  END IF;
  v_cycle := (SELECT fulfillment_notification_cycle_id FROM public.orders WHERE id = v_order);
  v_second := pg_temp.map_seed_shipment(v_order, f.merchant_id, 'GIGL-MAP-013B', now());
  PERFORM pg_temp.map_cancel_shipment(v_second, v_order, f.merchant_id);
  IF (SELECT fulfillment_notification_cycle_id FROM public.orders WHERE id = v_order)
       IS DISTINCT FROM v_cycle THEN
    RAISE EXCEPTION 'a repeat cancellation of a reopened order must not rotate its notification cycle';
  END IF;
END;
$rebook$;
