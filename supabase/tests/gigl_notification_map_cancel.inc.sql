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
  ) VALUES (
    f.shipment_id, f.epoch_id, f.order_id, f.merchant_id, f.event_id,
    'customer', 'cancelled'
  );
  IF (SELECT skip_reason FROM public.shipment_tracking_notification_outbox
      WHERE shipment_id = f.shipment_id AND audience = 'customer'
        AND notification_kind = 'cancelled') IS DISTINCT FROM 'superseded_by_newer_shipment' THEN
    RAISE EXCEPTION 'cancellation must be dropped when a newer live shipment exists';
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
