-- Section 4b of gigl_notification_map.sql (\ir part).
-- 4b. The merchant rebooking alert and the order reopen share one decision
-- (private.gigl_cancellation_reopens_order, 20261114183000/20261114183100),
-- built on the database-owned tracking_timeline_generation, whatever
-- created_at says. Like the tracking apply path, the notification row is
-- written first (the gate) and the status write follows (the order sync).
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

-- Writes the merchant 'cancelled' row, then the cancelled status; returns the
-- merchant alert as 'status/skip_reason'. The status write also stamps
-- last_tracked_at like the tracking apply path: a status change that leaves
-- last_tracked_at alone is a manual override, which skips every pending alert
-- of the shipment (tracking_terminal_override). p_cancel_order_between cancels
-- the order after the gate decided and before the order sync runs (a
-- concurrent order cancellation committing in between).
CREATE FUNCTION pg_temp.map_cancel_shipment(
  p_ids uuid[], p_order uuid, p_merchant uuid,
  p_cancel_order_between boolean DEFAULT false
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
  IF p_cancel_order_between THEN
    UPDATE public.orders SET cancelled_at = now() WHERE id = p_order;
  END IF;
  UPDATE public.shipments SET status = 'cancelled', last_tracked_at = now()
  WHERE id = p_ids[1];
  SELECT outbox.status || '/' || coalesce(outbox.skip_reason, '') INTO v_state
  FROM public.shipment_tracking_notification_outbox AS outbox
  WHERE outbox.shipment_id = p_ids[1] AND outbox.audience = 'merchant'
    AND outbox.notification_kind = 'cancelled';
  RETURN v_state;
END;
$cancel_shipment$;

CREATE FUNCTION pg_temp.map_seed_order(p_n integer, p_status text)
RETURNS uuid
LANGUAGE plpgsql
AS $order$
DECLARE
  v_order constant uuid := ('7a1c0000-0000-4000-8000-0000000001' || lpad(p_n::text, 2, '0'))::uuid;
BEGIN
  INSERT INTO public.orders (id, merchant_id, order_number, total, shipping_status)
  SELECT v_order, fixture.merchant_id, 'GIGL-MAP-1' || lpad(p_n::text, 2, '0'), 1000, p_status
  FROM gigl_map_fixture AS fixture;
  RETURN v_order;
END;
$order$;

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
  v_order := pg_temp.map_seed_order(11, 'processing');
  v_first := pg_temp.map_seed_shipment(v_order, f.merchant_id, 'GIGL-MAP-111A', now());
  v_second := pg_temp.map_seed_shipment(
    v_order, f.merchant_id, 'GIGL-MAP-111B', now() - interval '1 day'
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
  v_order := pg_temp.map_seed_order(12, 'processing');
  v_second := pg_temp.map_seed_shipment(
    v_order, f.merchant_id, 'GIGL-MAP-112A', now() + interval '1 day'
  );
  v_first := pg_temp.map_seed_shipment(v_order, f.merchant_id, 'GIGL-MAP-112B', now());
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
  v_order := pg_temp.map_seed_order(13, 'processing');
  v_first := pg_temp.map_seed_shipment(v_order, f.merchant_id, 'GIGL-MAP-113A', now());
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
  -- A second, never-linked shipment of the reopened order cancels: the order is
  -- still waiting for a shipment, so the merchant hears about this other
  -- shipment too, and the order's notification cycle stays put.
  v_second := pg_temp.map_seed_shipment(v_order, f.merchant_id, 'GIGL-MAP-113B', now());
  IF pg_temp.map_cancel_shipment(v_second, v_order, f.merchant_id)
       IS DISTINCT FROM 'pending/' THEN
    RAISE EXCEPTION 'another cancelled shipment of a reopened order must still alert the merchant';
  END IF;
  IF (SELECT fulfillment_notification_cycle_id FROM public.orders WHERE id = v_order)
       IS DISTINCT FROM v_cycle THEN
    RAISE EXCEPTION 'a repeat cancellation of a reopened order must not rotate its notification cycle';
  END IF;

  -- A failed replacement is still newer: the stale cancellation neither
  -- reopens the order nor tells the merchant to rebook.
  v_order := pg_temp.map_seed_order(14, 'processing');
  v_first := pg_temp.map_seed_shipment(v_order, f.merchant_id, 'GIGL-MAP-114A', now());
  v_second := pg_temp.map_seed_shipment(v_order, f.merchant_id, 'GIGL-MAP-114B', now());
  UPDATE public.orders SET shipment_id = v_first[1] WHERE id = v_order;
  UPDATE public.shipments SET status = 'failed' WHERE id = v_second[1];
  IF pg_temp.map_cancel_shipment(v_first, v_order, f.merchant_id)
       IS DISTINCT FROM 'skipped/superseded_by_newer_shipment'
    OR (SELECT shipment_id FROM public.orders WHERE id = v_order)
       IS DISTINCT FROM v_first[1]
  THEN
    RAISE EXCEPTION 'a cancellation behind a failed replacement must not alert the merchant or reopen the order';
  END IF;

  -- An order that was cancelled is never reopened, so the merchant is not told
  -- to rebook it.
  v_order := pg_temp.map_seed_order(15, 'processing');
  v_first := pg_temp.map_seed_shipment(v_order, f.merchant_id, 'GIGL-MAP-115A', now());
  UPDATE public.orders SET shipment_id = v_first[1], cancelled_at = now()
  WHERE id = v_order;
  IF pg_temp.map_cancel_shipment(v_first, v_order, f.merchant_id)
       IS DISTINCT FROM 'skipped/cancellation_not_reopened'
    OR (SELECT shipment_id FROM public.orders WHERE id = v_order)
       IS DISTINCT FROM v_first[1]
  THEN
    RAISE EXCEPTION 'a cancelled order must not alert the merchant to rebook or be reopened';
  END IF;

  -- An order that points at another shipment is not reopened by this one's
  -- cancellation, so the merchant is not told to rebook it.
  v_order := pg_temp.map_seed_order(16, 'processing');
  v_second := pg_temp.map_seed_shipment(v_order, f.merchant_id, 'GIGL-MAP-116A', now());
  v_first := pg_temp.map_seed_shipment(v_order, f.merchant_id, 'GIGL-MAP-116B', now());
  UPDATE public.orders SET shipment_id = v_second[1] WHERE id = v_order;
  IF pg_temp.map_cancel_shipment(v_first, v_order, f.merchant_id)
       IS DISTINCT FROM 'skipped/cancellation_not_reopened'
    OR (SELECT shipment_id FROM public.orders WHERE id = v_order)
       IS DISTINCT FROM v_second[1]
  THEN
    RAISE EXCEPTION 'a cancellation of an unlinked shipment must not alert the merchant or reopen the order';
  END IF;

  -- A refunded order cannot be rebooked (claim_order_shipment_booking refuses
  -- it), so it is neither reopened nor prompted.
  v_order := pg_temp.map_seed_order(17, 'processing');
  v_first := pg_temp.map_seed_shipment(v_order, f.merchant_id, 'GIGL-MAP-117A', now());
  UPDATE public.orders SET shipment_id = v_first[1] WHERE id = v_order;
  UPDATE public.orders SET payment_status = 'refunded' WHERE id = v_order;
  IF pg_temp.map_cancel_shipment(v_first, v_order, f.merchant_id)
       IS DISTINCT FROM 'skipped/cancellation_not_reopened'
    OR (SELECT shipment_id FROM public.orders WHERE id = v_order)
       IS DISTINCT FROM v_first[1]
  THEN
    RAISE EXCEPTION 'a refunded order must not alert the merchant to rebook or be reopened';
  END IF;

  -- The order is cancelled after the gate let the alert through and before the
  -- order sync runs: the sync settles the pending alert instead of leaving a
  -- rebooking prompt for an order that stays closed.
  v_order := pg_temp.map_seed_order(18, 'processing');
  v_first := pg_temp.map_seed_shipment(v_order, f.merchant_id, 'GIGL-MAP-118A', now());
  UPDATE public.orders SET shipment_id = v_first[1] WHERE id = v_order;
  IF pg_temp.map_cancel_shipment(v_first, v_order, f.merchant_id, true)
       IS DISTINCT FROM 'skipped/cancellation_not_reopened'
    OR (SELECT shipment_id FROM public.orders WHERE id = v_order)
       IS DISTINCT FROM v_first[1]
  THEN
    RAISE EXCEPTION 'an order cancelled between the gate and the sync must not keep a rebooking prompt';
  END IF;
END;
$rebook$;
