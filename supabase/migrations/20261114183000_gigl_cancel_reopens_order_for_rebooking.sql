-- A GIG (GIGL) shipment cancellation cancels only the shipping, never the
-- order (owner rule, 2026-11-14, after order ORD-261113-00PN-N was cancelled
-- by GIG's sync of a merchant-cancelled waybill and could not be reopened).
--
-- 1. private.sync_gigl_tracking_order_status (latest: 20260802000400) keeps
--    every other mapping, but a 'cancelled' shipment now moves its order back
--    to 'processing' and clears the order's active shipment link
--    (shipment_id, tracking_number, selected_quote_id and, through
--    private.stamp_gigl_order_economics, the wallet funding source) so the
--    merchant can rebook. Only the shipment the order points at (or an order
--    with no link) is reopened; a cancelled, delivered, completed or returned
--    order is left alone. The order is cancelled only by an order
--    cancellation.
--    The merchant-wallet refund stays with the attested provider-cancellation
--    path (20261102053310/20261102053320), which runs inside
--    apply_gigl_tracking_result before the shipments update. When a booked or
--    needs_reconciliation charge is still on the order, the reopen raises the
--    same 55P03 'active_merchant_shipping_charge' that
--    private.prevent_active_gigl_shipping_cancellation used to raise, so an
--    unverified cancellation still stops for manual handling and refunds
--    nothing.
-- 2. private.gate_gigl_tracking_notification skips the customer 'cancelled'
--    alert unless the order itself is cancelled (shipment-only cancellation).
--    The merchant alert copy says the shipment needs rebooking (app code).

CREATE OR REPLACE FUNCTION private.sync_gigl_tracking_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_shipping_status text;
  v_order_id uuid;
BEGIN
  IF NEW.provider IS DISTINCT FROM 'GIGL'
    OR NEW.order_id IS NULL
    OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'cancelled' THEN
    SELECT orders.id INTO v_order_id
    FROM public.orders AS orders
    WHERE orders.id = NEW.order_id
      AND orders.merchant_id = NEW.merchant_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.shipments AS newer_shipment
        WHERE newer_shipment.order_id = NEW.order_id
          AND newer_shipment.merchant_id = NEW.merchant_id
          AND newer_shipment.tracking_timeline_generation
            > NEW.tracking_timeline_generation
      )
      AND (orders.shipment_id = NEW.id OR orders.shipment_id IS NULL)
      AND orders.cancelled_at IS NULL
      AND coalesce(orders.shipping_status, '') NOT IN (
        'delivered', 'completed', 'cancelled', 'canceled', 'returned'
      )
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.merchant_shipping_charges AS charge
      WHERE charge.order_id = v_order_id
        AND charge.status IN ('booked', 'needs_reconciliation')
    ) THEN
      RAISE EXCEPTION 'active_merchant_shipping_charge' USING ERRCODE = '55P03';
    END IF;

    UPDATE public.orders AS orders
    SET shipping_status = 'processing',
        shipment_id = NULL,
        tracking_number = NULL,
        selected_quote_id = NULL,
        shipping_funding_source = NULL,
        updated_at = now()
    WHERE orders.id = v_order_id;
    RETURN NEW;
  END IF;

  v_shipping_status := CASE NEW.status
    WHEN 'pending' THEN 'pending'
    WHEN 'booked' THEN 'shipped'
    WHEN 'pickup_scheduled' THEN 'shipped'
    WHEN 'picked_up' THEN 'shipped'
    WHEN 'in_transit' THEN 'shipped'
    WHEN 'out_for_delivery' THEN 'shipped'
    WHEN 'delivered' THEN 'delivered'
    WHEN 'failed' THEN 'failed'
    WHEN 'returned' THEN 'returned'
    ELSE 'processing'
  END;

  UPDATE public.orders AS orders
  SET shipping_status = v_shipping_status, updated_at = now()
  WHERE orders.id = NEW.order_id
    AND orders.merchant_id = NEW.merchant_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.shipments AS newer_shipment
      WHERE newer_shipment.order_id = NEW.order_id
        AND newer_shipment.merchant_id = NEW.merchant_id
        AND newer_shipment.tracking_timeline_generation
          > NEW.tracking_timeline_generation
    )
    AND orders.shipping_status IS DISTINCT FROM v_shipping_status
    AND orders.shipping_status IS DISTINCT FROM 'completed'
    AND (
      orders.shipping_status NOT IN (
        'delivered', 'completed', 'cancelled', 'canceled', 'returned', 'failed'
      )
      OR v_shipping_status IN ('delivered', 'failed', 'returned')
    )
    AND (
      NEW.status IS DISTINCT FROM 'failed'
      OR NEW.last_tracked_at IS NOT DISTINCT FROM OLD.last_tracked_at
      OR orders.shipping_status NOT IN ('shipped', 'delivered')
    );
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.sync_gigl_tracking_order_status()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.sync_gigl_tracking_order_status()
  FROM PUBLIC, anon, authenticated, service_role;

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
