-- A GIG (GIGL) shipment cancellation cancels only the shipping, never the
-- order (owner rule, 2026-11-14, after order ORD-261113-00PN-N was cancelled
-- by GIG's sync of a merchant-cancelled waybill and could not be reopened).
--
-- 1. private.sync_gigl_tracking_order_status (latest: 20260802000400) keeps
--    every other mapping, but a 'cancelled' shipment now moves its order back
--    to 'processing' and clears the order's active shipment link
--    (shipment_id, tracking_number and, for non-customer_checkout orders such
--    as merchant_wallet, selected_quote_id and shipping_funding_source) and
--    rotates fulfillment_notification_cycle_id so replacement-shipment emails
--    are not deduplicated against the cancelled shipment. Paid
--    customer_checkout orders keep selected_quote_id, shipping_funding_source
--    and stamped economics intact (needed for station deliveries and settled
--    checkouts). Only the shipment the order points at
--    (or a NULL-linked order with no other non-cancelled shipment) is
--    reopened; a cancelled, delivered, completed, returned or failed order is
--    left alone. The order is cancelled only by an order cancellation.
--    The merchant-wallet refund stays with the attested provider-cancellation
--    path (20261102053310/20261102053320), which runs inside
--    apply_gigl_tracking_result before the shipments update. When a reserved,
--    provider_submitting, booked or needs_reconciliation charge is still on
--    the order, the reopen raises the same 55P03 'active_merchant_shipping_charge'
--    that private.prevent_active_gigl_shipping_cancellation used to raise, so an
--    unverified cancellation or active reservation/submission stops for manual
--    handling and refunds nothing. A repeat cancellation of an order that is
--    already reopened (processing, unlinked, nothing left to clear) changes
--    nothing and keeps the notification cycle.
-- 2. The notification gate (private.gate_gigl_tracking_notification) follows
--    in 20261114183100_gigl_cancel_rebooking_alert_gate.sql; it reads the
--    reopen decision defined here so the merchant rebooking alert and the
--    reopen can never disagree.

-- The one definition of "a newer shipment" shared by the reopen in
-- private.sync_gigl_tracking_order_status and the merchant rebooking alert in
-- private.gate_gigl_tracking_notification: another shipment of the same order
-- and merchant with a higher tracking_timeline_generation (any status).
CREATE OR REPLACE FUNCTION private.gigl_has_newer_order_shipment(
  p_order_id uuid,
  p_merchant_id uuid,
  p_generation integer
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shipments AS newer_shipment
    WHERE newer_shipment.order_id = p_order_id
      AND newer_shipment.merchant_id = p_merchant_id
      AND newer_shipment.tracking_timeline_generation > p_generation
  );
$$;
ALTER FUNCTION private.gigl_has_newer_order_shipment(uuid, uuid, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.gigl_has_newer_order_shipment(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- The one decision "does this cancelled shipment reopen its order": the order
-- is open (not cancelled, refunded, or delivered/completed/cancelled/returned/
-- failed), no newer shipment replaced this one, and the order points at this shipment
-- (or points at none and no other non-cancelled shipment exists). Read by the
-- reopen in private.sync_gigl_tracking_order_status and by the merchant
-- rebooking alert in private.gate_gigl_tracking_notification.
CREATE OR REPLACE FUNCTION private.gigl_cancellation_reopens_order(
  p_shipment_id uuid,
  p_order_id uuid,
  p_merchant_id uuid,
  p_generation integer
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders AS orders
    WHERE orders.id = p_order_id
      AND orders.merchant_id = p_merchant_id
      AND orders.cancelled_at IS NULL
      AND coalesce(orders.shipping_status, '') NOT IN (
        'delivered', 'completed', 'cancelled', 'canceled', 'returned', 'failed'
      )
      -- claim_order_shipment_booking refuses these, so a rebooking could not
      -- succeed.
      AND pg_catalog.lower(pg_catalog.btrim(coalesce(orders.payment_status, '')))
        NOT IN ('refunded', 'cancelled', 'canceled')
      AND NOT private.gigl_has_newer_order_shipment(
        p_order_id, p_merchant_id, p_generation
      )
      AND (
        orders.shipment_id = p_shipment_id
        OR (
          orders.shipment_id IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM public.shipments AS other_shipment
            WHERE other_shipment.order_id = p_order_id
              AND other_shipment.merchant_id = p_merchant_id
              AND other_shipment.id <> p_shipment_id
              AND other_shipment.status <> 'cancelled'
          )
        )
      )
  );
$$;
ALTER FUNCTION private.gigl_cancellation_reopens_order(uuid, uuid, uuid, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.gigl_cancellation_reopens_order(uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- Settles the merchant rebooking alert once the reopen decision is serialized
-- under the order lock: the gate decided before the shipments update, so an
-- order change committed in between (for example a concurrent order
-- cancellation) must still silence a prompt for an order that stays closed.
CREATE OR REPLACE FUNCTION private.gigl_skip_unreopened_cancellation_alert(
  p_shipment_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.shipment_tracking_notification_outbox AS outbox
  SET status = 'skipped',
      skipped_at = now(),
      updated_at = now(),
      skip_reason = 'cancellation_not_reopened'
  WHERE outbox.shipment_id = p_shipment_id
    AND outbox.audience = 'merchant'
    AND outbox.notification_kind = 'cancelled'
    AND outbox.status = 'pending';
$$;
ALTER FUNCTION private.gigl_skip_unreopened_cancellation_alert(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.gigl_skip_unreopened_cancellation_alert(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.sync_gigl_tracking_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_shipping_status text;
  v_order_id uuid;
  v_has_newer_shipment boolean;
  v_reopens boolean := false;
BEGIN
  IF NEW.provider IS DISTINCT FROM 'GIGL'
    OR NEW.order_id IS NULL
    OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'cancelled' THEN
    -- Lock the order that is still open for a shipping change (the same
    -- cancelled/terminal filter private.gigl_cancellation_reopens_order starts
    -- from; that decision also weighs the payment status) before the charge
    -- guard, so the guard keeps covering every such order.
    SELECT orders.id
    INTO v_order_id
    FROM public.orders AS orders
    WHERE orders.id = NEW.order_id
      AND orders.merchant_id = NEW.merchant_id
      AND orders.cancelled_at IS NULL
      AND coalesce(orders.shipping_status, '') NOT IN (
        'delivered', 'completed', 'cancelled', 'canceled', 'returned', 'failed'
      )
    FOR UPDATE;
    IF FOUND THEN
      v_has_newer_shipment := private.gigl_has_newer_order_shipment(
        NEW.order_id, NEW.merchant_id, NEW.tracking_timeline_generation
      );

      -- Refuse an unrefunded cancellation when an active wallet charge still
      -- belongs to this shipment or to the current non-superseded order
      -- timeline (covers recovered decoy shipments before orders.shipment_id
      -- moves).
      IF EXISTS (
        SELECT 1
        FROM public.merchant_shipping_charges AS charge
        WHERE charge.order_id = v_order_id
          AND charge.status IN (
            'reserved', 'provider_submitting', 'booked', 'needs_reconciliation'
          )
          AND (
            charge.shipment_id = NEW.id
            OR NOT v_has_newer_shipment
          )
      ) THEN
        RAISE EXCEPTION 'active_merchant_shipping_charge' USING ERRCODE = '55P03';
      END IF;

      v_reopens := private.gigl_cancellation_reopens_order(
        NEW.id, NEW.order_id, NEW.merchant_id, NEW.tracking_timeline_generation
      );
    END IF;

    IF NOT v_reopens THEN
      PERFORM private.gigl_skip_unreopened_cancellation_alert(NEW.id);
      RETURN NEW;
    END IF;

    UPDATE public.orders AS orders
    SET shipping_status = 'processing',
        shipment_id = NULL,
        tracking_number = NULL,
        fulfillment_notification_cycle_id = pg_catalog.gen_random_uuid(),
        selected_quote_id = CASE
          WHEN orders.shipping_funding_source = 'customer_checkout'
            THEN orders.selected_quote_id
          ELSE NULL
        END,
        shipping_funding_source = CASE
          WHEN orders.shipping_funding_source = 'customer_checkout'
            THEN orders.shipping_funding_source
          ELSE NULL
        END,
        updated_at = now()
    WHERE orders.id = v_order_id
      -- Skip an order that is already reopened (processing, unlinked, no
      -- funding or quote left to clear): a repeat cancellation must not
      -- rotate its notification cycle.
      AND (
        orders.shipping_status IS DISTINCT FROM 'processing'
        OR orders.shipment_id IS NOT NULL
        OR orders.tracking_number IS NOT NULL
        OR (
          orders.shipping_funding_source IS DISTINCT FROM 'customer_checkout'
          AND (
            orders.selected_quote_id IS NOT NULL
            OR orders.shipping_funding_source IS NOT NULL
          )
        )
      );
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
