-- GIG cancellation rebooking alert gate (2/2 of the cancellation rework that
-- starts in 20261114183000_gigl_cancel_reopens_order_for_rebooking.sql, which
-- defines private.gigl_has_newer_order_shipment and
-- private.gigl_cancellation_reopens_order, the one decision the reopen uses).
--
-- private.gate_gigl_tracking_notification:
--   * customer 'cancelled' is skipped unless the order itself is cancelled
--     (a shipment-only cancellation never alerts the customer), and keeps the
--     existing skip when a newer live shipment exists
--     (private.gigl_cancellation_superseded, unchanged);
--   * merchant 'cancelled' is the rebooking prompt, so it is sent only when the
--     cancellation reopens the order. A stale cancel (a newer shipment by the
--     database-owned tracking_timeline_generation, whatever its status or
--     created_at), a cancelled or finished order, or an order linked to another
--     shipment never tells the merchant to rebook. Shipments without an order
--     (repair pickups) keep their merchant alert.
--   The customer alert (order cancelled) and the merchant alert (order
--   reopened) are mutually exclusive by construction. The customer skip keeps
--   private.gigl_cancellation_superseded (live newer shipment by created_at)
--   on purpose: it is the existing rule the notification claim and dispatch
--   functions also apply (20261103190400), and it only ever applies to a
--   cancelled order, which the reopen never touches, so it cannot disagree
--   with the reopen decision. The merchant alert copy says the shipment needs
--   rebooking (app code).

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
  ELSIF NEW.audience = 'merchant' AND NEW.notification_kind = 'cancelled'
    AND EXISTS (
      SELECT 1
      FROM public.shipments AS cancelled_shipment
      WHERE cancelled_shipment.id = NEW.shipment_id
        AND private.gigl_has_newer_order_shipment(
          cancelled_shipment.order_id,
          cancelled_shipment.merchant_id,
          cancelled_shipment.tracking_timeline_generation
        )
    )
  THEN
    NEW.status := 'skipped';
    NEW.skipped_at := now();
    NEW.skip_reason := 'superseded_by_newer_shipment';
  ELSIF NEW.audience = 'merchant' AND NEW.notification_kind = 'cancelled'
    AND EXISTS (
      SELECT 1
      FROM public.shipments AS cancelled_shipment
      WHERE cancelled_shipment.id = NEW.shipment_id
        AND cancelled_shipment.order_id IS NOT NULL
        AND NOT private.gigl_cancellation_reopens_order(
          cancelled_shipment.id,
          cancelled_shipment.order_id,
          cancelled_shipment.merchant_id,
          cancelled_shipment.tracking_timeline_generation
        )
    )
  THEN
    NEW.status := 'skipped';
    NEW.skipped_at := now();
    NEW.skip_reason := 'cancellation_not_reopened';
  ELSIF NEW.audience = 'customer' AND NEW.notification_kind = 'cancelled'
    AND private.gigl_cancellation_superseded(NEW.shipment_id)
  THEN
    NEW.status := 'skipped';
    NEW.skipped_at := now();
    NEW.skip_reason := 'superseded_by_newer_shipment';
  ELSIF NEW.audience = 'customer' AND NEW.notification_kind = 'cancelled'
    AND NOT EXISTS (
      SELECT 1
      FROM public.orders AS orders
      WHERE orders.id = NEW.order_id
        AND orders.merchant_id = NEW.merchant_id
        AND (
          orders.cancelled_at IS NOT NULL
          OR orders.shipping_status IN ('cancelled', 'canceled')
        )
    )
  THEN
    NEW.status := 'skipped';
    NEW.skipped_at := now();
    NEW.skip_reason := 'shipment_only_cancellation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.gate_gigl_tracking_notification()
  FROM PUBLIC, anon, authenticated;
