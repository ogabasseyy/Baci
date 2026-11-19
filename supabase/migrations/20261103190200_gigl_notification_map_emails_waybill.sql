-- GIG notification map (3/5): customer emails from GIG events and waybill-change alerts.

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
  )) NOT VALID;

CREATE OR REPLACE FUNCTION private.enqueue_customer_email_on_gigl_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_event_type text;
  v_shipment_tracking text;
BEGIN
  IF NEW.audience <> 'customer' OR NEW.status <> 'pending' OR NEW.order_id IS NULL
  THEN
    RETURN NEW;
  END IF;
  v_event_type := CASE NEW.notification_kind
    -- A poll that first sees the parcel past pickup must still send "shipped".
    WHEN 'picked_up' THEN 'order_shipped'
    WHEN 'transit_started' THEN 'order_shipped'
    WHEN 'out_for_delivery' THEN 'order_shipped'
    WHEN 'delivery_attempt_failed' THEN 'order_delivery_failed'
    WHEN 'return_in_progress' THEN 'order_returned'
    ELSE NULL
  END;
  IF v_event_type IS NULL THEN
    RETURN NEW;
  END IF;
  -- Import synchronisation stays silent via the transaction-local flag, not
  -- permanent import markers, so a later GIG fulfilment still notifies.
  IF current_setting('baci.order_notification_outbox.suppress_enqueue', true) = 'true' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  -- Snapshot the tracking number of the shipment that produced this event so
  -- a later replacement shipment can be told apart from it.
  SELECT shipment.tracking_number INTO v_shipment_tracking
  FROM public.shipments AS shipment WHERE shipment.id = NEW.shipment_id;
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
      'fulfillment_tracking_number', coalesce(v_shipment_tracking, v_order.tracking_number),
      'fulfillment_tracking_token', v_order.tracking_token
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
    metadata = public.order_notification_outbox.metadata || EXCLUDED.metadata,
    updated_at = now()
  WHERE public.order_notification_outbox.status = 'failed'
    OR (
      public.order_notification_outbox.status = 'skipped'
      AND public.order_notification_outbox.skip_reason
        IS DISTINCT FROM 'delivery_outcome_unknown'
    );
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
  -- Only a replacement shipment row counts. In-place waybill edits are the
  -- audited "swap" path (supabase/tests/gigl_provider_cancellation_wallet_refund
  -- T5) and must not write tracking events.
  IF NEW.provider IS DISTINCT FROM 'GIGL' OR NEW.order_id IS NULL
    OR NEW.status IN ('cancelled', 'delivered', 'failed', 'returned')
    OR nullif(btrim(NEW.tracking_number), '') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.shipments AS previous
      WHERE previous.order_id = NEW.order_id
        AND previous.id <> NEW.id
        AND previous.provider = 'GIGL'
        -- A delivered predecessor means a new fulfilment cycle, not a replacement.
        AND previous.status <> 'delivered'
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
