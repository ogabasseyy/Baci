-- GIG shipment notification map (owner-approved 2026-11-03).
--   * Merchant pushes go to the owner plus staff with orders.fulfill only.
--   * Each merchant event can be muted per merchant (out_for_delivery is OFF
--     by default; every other event is ON until the merchant turns it off).
--   * Customer "shipped" moves from booking to GIG's picked_up event.
--   * Customer cancellations are dropped when a newer live shipment exists.

-- 1. Per-merchant event toggles -------------------------------------------------
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS shipment_event_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.notification_preferences
  DROP CONSTRAINT IF EXISTS notification_preferences_shipment_event_preferences_object;
ALTER TABLE public.notification_preferences
  ADD CONSTRAINT notification_preferences_shipment_event_preferences_object
  CHECK (jsonb_typeof(shipment_event_preferences) = 'object');
COMMENT ON COLUMN public.notification_preferences.shipment_event_preferences IS
  'Per-event merchant GIG shipment push toggles keyed pickup_scheduled, pickup_delayed, picked_up, out_for_delivery, delivered, failed, returned, cancelled. Missing key = default (on, except out_for_delivery which is off).';

-- 2. Policy rows ------------------------------------------------------------
ALTER TABLE private.gigl_tracking_notification_policy
  DROP CONSTRAINT IF EXISTS gigl_tracking_notification_policy_notification_kind_check;
ALTER TABLE private.gigl_tracking_notification_policy
  ADD CONSTRAINT gigl_tracking_notification_policy_notification_kind_check
  CHECK (notification_kind IN (
    'pickup_assigned', 'pickup_en_route', 'pickup_delayed', 'picked_up',
    'transit_started', 'out_for_delivery', 'delivered',
    'delivery_attempt_failed', 'return_in_progress', 'shipment_exception',
    'failed', 'returned', 'cancelled', 'waybill_changed'
  ));
ALTER TABLE public.shipment_tracking_notification_outbox
  DROP CONSTRAINT IF EXISTS shipment_tracking_notification_outbox_notification_kind_check;
ALTER TABLE public.shipment_tracking_notification_outbox
  ADD CONSTRAINT shipment_tracking_notification_outbox_notification_kind_check
  CHECK (notification_kind IN (
    'pickup_assigned', 'pickup_en_route', 'pickup_delayed', 'picked_up',
    'transit_started', 'out_for_delivery', 'delivered',
    'delivery_attempt_failed', 'return_in_progress', 'shipment_exception',
    'failed', 'returned', 'cancelled', 'waybill_changed'
  ));

INSERT INTO private.gigl_tracking_notification_policy (
  raw_status, normalized_status, audience, notification_kind
) VALUES
  ('DLP', NULL, 'merchant', 'pickup_delayed'),
  (NULL, 'picked_up', 'customer', 'picked_up'),
  (NULL, 'out_for_delivery', 'merchant', 'out_for_delivery'),
  (NULL, 'delivered', 'merchant', 'delivered'),
  (NULL, 'cancelled', 'customer', 'cancelled')
ON CONFLICT DO NOTHING;

-- 3. Merchant toggle + superseded-shipment gate on enqueue ------------------------
CREATE OR REPLACE FUNCTION private.gigl_merchant_event_enabled(
  p_merchant_id uuid, p_notification_kind text
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH k AS (
    SELECT CASE p_notification_kind
      WHEN 'pickup_assigned' THEN 'pickup_scheduled'
      WHEN 'pickup_en_route' THEN 'pickup_scheduled'
      ELSE p_notification_kind
    END AS key
  )
  SELECT coalesce(
    (SELECT (preferences.shipment_event_preferences ->> k.key)::boolean
     FROM public.notification_preferences AS preferences
     WHERE preferences.merchant_id = p_merchant_id
       AND jsonb_typeof(preferences.shipment_event_preferences -> k.key) = 'boolean'),
    k.key <> 'out_for_delivery'
  )
  FROM k;
$$;
REVOKE ALL ON FUNCTION private.gigl_merchant_event_enabled(uuid, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.gate_gigl_tracking_notification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;
  IF NEW.audience = 'merchant'
    AND NOT private.gigl_merchant_event_enabled(NEW.merchant_id, NEW.notification_kind)
  THEN
    NEW.status := 'skipped';
    NEW.skipped_at := now();
    NEW.skip_reason := 'merchant_preference_off';
  ELSIF NEW.audience = 'customer' AND NEW.notification_kind = 'cancelled'
    AND EXISTS (
      SELECT 1
      FROM public.shipments AS cancelled
      JOIN public.shipments AS newer
        ON newer.order_id = cancelled.order_id
        AND newer.id <> cancelled.id
        AND newer.status <> 'cancelled'
        AND newer.created_at > cancelled.created_at
      WHERE cancelled.id = NEW.shipment_id
    )
  THEN
    NEW.status := 'skipped';
    NEW.skipped_at := now();
    NEW.skip_reason := 'superseded_by_newer_shipment';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.gate_gigl_tracking_notification()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS gate_gigl_tracking_notification
  ON public.shipment_tracking_notification_outbox;
CREATE TRIGGER gate_gigl_tracking_notification
  BEFORE INSERT ON public.shipment_tracking_notification_outbox
  FOR EACH ROW EXECUTE FUNCTION private.gate_gigl_tracking_notification();

-- 4. Customer emails driven by GIG events ----------------------------------------------
--   picked_up -> order_shipped, delivery_attempt_failed -> order_delivery_failed,
--   return_in_progress -> order_returned. (Delivered keeps using the existing
--   orders.shipping_status trigger.)
ALTER TABLE public.order_notification_outbox
  DROP CONSTRAINT IF EXISTS order_notification_outbox_event_type_check;
ALTER TABLE public.order_notification_outbox
  ADD CONSTRAINT order_notification_outbox_event_type_check CHECK (event_type IN (
    'order_shipped', 'order_delivered', 'order_delivery_failed', 'order_returned',
    'manual_order_invoice', 'manual_order_receipt'
  ));

CREATE OR REPLACE FUNCTION private.enqueue_customer_email_on_gigl_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_event_type text;
BEGIN
  IF NEW.audience <> 'customer' OR NEW.status <> 'pending' OR NEW.order_id IS NULL
  THEN
    RETURN NEW;
  END IF;
  v_event_type := CASE NEW.notification_kind
    WHEN 'picked_up' THEN 'order_shipped'
    WHEN 'delivery_attempt_failed' THEN 'order_delivery_failed'
    WHEN 'return_in_progress' THEN 'order_returned'
    ELSE NULL
  END;
  IF v_event_type IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id;
  IF NOT FOUND OR v_order.external_source IS NOT NULL
    OR v_order.import_job_id IS NOT NULL
  THEN
    RETURN NEW;
  END IF;
  -- Never email "shipped" twice for the same fulfilment cycle.
  IF v_event_type = 'order_shipped' AND EXISTS (
    SELECT 1 FROM public.order_notification_outbox AS existing
    WHERE existing.order_id = v_order.id
      AND existing.event_type = 'order_shipped'
      AND existing.fulfillment_cycle_id IS NOT DISTINCT FROM v_order.fulfillment_notification_cycle_id
      AND existing.status IN ('pending', 'processing', 'sent')
  ) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.order_notification_outbox (
    order_id, merchant_id, event_type, fulfillment_cycle_id, next_attempt_at, metadata
  ) VALUES (
    v_order.id, v_order.merchant_id, v_event_type,
    v_order.fulfillment_notification_cycle_id, now(),
    jsonb_build_object(
      'shipping_status', v_order.shipping_status,
      'source', 'gigl_' || NEW.notification_kind,
      'fulfillment_courier_name', v_order.shipping_provider,
      'fulfillment_tracking_number', v_order.tracking_number,
      'fulfillment_tracking_token', v_order.tracking_token
    )
  )
  ON CONFLICT (order_id, event_type, fulfillment_cycle_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enqueue_customer_email_on_gigl_event()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_enqueue_customer_email_on_gigl_event
  ON public.shipment_tracking_notification_outbox;
CREATE TRIGGER zz_enqueue_customer_email_on_gigl_event
  AFTER INSERT ON public.shipment_tracking_notification_outbox
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_customer_email_on_gigl_event();

-- 4b. Waybill replaced / relinked -> merchant + customer alert --------------------------
-- A replacement GIG shipment on an order that already had one carries a
-- marker tracking event so the existing outbox can carry the notification.
CREATE OR REPLACE FUNCTION private.notify_gigl_waybill_changed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_epoch uuid;
  v_event uuid;
BEGIN
  IF NEW.provider IS DISTINCT FROM 'GIGL' OR NEW.order_id IS NULL
    OR NEW.status = 'cancelled'
    OR NOT EXISTS (
      SELECT 1 FROM public.shipments AS previous
      WHERE previous.order_id = NEW.order_id
        AND previous.id <> NEW.id
        AND previous.provider = 'GIGL'
        AND upper(btrim(previous.tracking_number)) <> upper(btrim(NEW.tracking_number))
    )
  THEN
    RETURN NEW;
  END IF;
  SELECT monitor.tracking_epoch_id INTO v_epoch
  FROM public.shipment_tracking_monitors AS monitor
  WHERE monitor.shipment_id = NEW.id;
  IF v_epoch IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.shipment_tracking_events (
    shipment_id, tracking_epoch_id, tracking_number, provider,
    provider_event_key, raw_status, normalized_status, description, occurred_at
  ) VALUES (
    NEW.id, v_epoch, NEW.tracking_number, 'GIGL',
    'waybill-changed:' || NEW.id::text, 'WAYBILL_CHANGED', 'booked',
    'Tracking number changed', now()
  )
  ON CONFLICT (shipment_id, tracking_epoch_id, provider_event_key) DO NOTHING
  RETURNING id INTO v_event;
  IF v_event IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.shipment_tracking_notification_outbox (
    shipment_id, tracking_epoch_id, order_id, merchant_id, tracking_event_id,
    audience, notification_kind
  ) VALUES
    (NEW.id, v_epoch, NEW.order_id, NEW.merchant_id, v_event, 'merchant', 'waybill_changed'),
    (NEW.id, v_epoch, NEW.order_id, NEW.merchant_id, v_event, 'customer', 'waybill_changed')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.notify_gigl_waybill_changed()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_notify_gigl_waybill_changed ON public.shipments;
CREATE TRIGGER zz_notify_gigl_waybill_changed
  AFTER INSERT ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION private.notify_gigl_waybill_changed();

-- 5. No shipped email at booking for GIG orders -------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_order_fulfillment_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type text;
BEGIN
  IF TG_OP <> 'UPDATE'
    OR current_setting('baci.order_notification_outbox.suppress_enqueue', true) = 'true'
    OR NEW.shipping_status IS NOT DISTINCT FROM OLD.shipping_status
  THEN
    RETURN NEW;
  END IF;

  IF NEW.shipping_status IN ('shipped', 'out_for_delivery')
    AND OLD.shipping_status NOT IN ('shipped', 'out_for_delivery', 'delivered', 'completed')
  THEN
    v_event_type := 'order_shipped';
  ELSIF NEW.shipping_status IN ('delivered', 'completed')
    AND OLD.shipping_status NOT IN ('delivered', 'completed')
  THEN
    v_event_type := 'order_delivered';
  ELSE
    RETURN NEW;
  END IF;

  -- GIG orders are told "shipped" when GIG picks the parcel up (see
  -- private.enqueue_customer_email_on_gigl_event), not when it is booked.
  IF v_event_type = 'order_shipped' AND EXISTS (
    SELECT 1 FROM public.shipments AS shipment
    WHERE shipment.order_id = NEW.id
      AND shipment.provider = 'GIGL'
      AND shipment.status IN ('pending', 'booked', 'pickup_scheduled')
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.order_notification_outbox (
    order_id,
    merchant_id,
    event_type,
    fulfillment_cycle_id,
    next_attempt_at,
    metadata
  )
  VALUES (
    NEW.id,
    NEW.merchant_id,
    v_event_type,
    NEW.fulfillment_notification_cycle_id,
    now(),
    jsonb_build_object(
      'previous_shipping_status', OLD.shipping_status,
      'shipping_status', NEW.shipping_status,
      'source', 'orders_shipping_status_trigger',
      'fulfillment_courier_name', NEW.shipping_provider,
      'fulfillment_tracking_number', NEW.tracking_number,
      'fulfillment_tracking_token', NEW.tracking_token
    )
  )
  ON CONFLICT (order_id, event_type, fulfillment_cycle_id) DO UPDATE
  SET
    status = 'pending',
    attempt_count = 0,
    next_attempt_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    last_error = NULL,
    skip_reason = NULL,
    skipped_at = NULL,
    dispatch_started_at = NULL,
    metadata = order_notification_outbox.metadata || EXCLUDED.metadata,
    updated_at = now()
  WHERE order_notification_outbox.status = 'failed'
    OR (
      order_notification_outbox.status = 'skipped'
      AND order_notification_outbox.skip_reason
        IS DISTINCT FROM 'delivery_outcome_unknown'
    );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_order_fulfillment_notification()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_order_fulfillment_notification()
  TO service_role;

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
  WITH expired_delivery AS (
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
