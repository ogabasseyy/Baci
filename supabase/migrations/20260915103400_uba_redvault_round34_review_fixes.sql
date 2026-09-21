-- Round-34 review fixes.
-- P1 (unpaid REDVAULT claims): REDVAULT is a prepaid hosted rail, but the
-- shipment-booking claim accepted unpaid REDVAULT orders and the direct
-- /api/shipping/book path only applies its prepaid assertion to GIGL. A
-- merchant could therefore book a Topship/Shiip shipment for a prepared
-- REDVAULT draft before hosted payment succeeds, while the customer can
-- still fail or cancel payment after a provider shipment exists. The claim
-- and the pre-submit payment assertion now read payment_method under the
-- same order lock and reject REDVAULT claims unless payment_status is
-- paid. Other rails are unchanged (pay-on-delivery legitimately books
-- unpaid).
CREATE OR REPLACE FUNCTION public.claim_order_shipment_booking(
  p_order_id uuid,
  p_merchant_id uuid,
  p_lock_token uuid,
  p_lock_timeout_seconds integer DEFAULT 900
)
RETURNS TABLE(
  claimed boolean,
  shipment_id uuid,
  tracking_number text,
  shipping_status text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_payment_method text;
  v_payment_status text;
  v_shipping_status text;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_merchant_access(p_merchant_id) THEN
    RAISE EXCEPTION 'forbidden_claim_order_shipment_booking'
      USING ERRCODE = '42501';
  END IF;

  IF p_order_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
    );
  END IF;
  SELECT o.payment_method, o.payment_status, o.shipping_status
  INTO v_payment_method, v_payment_status, v_shipping_status
  FROM public.orders AS o
  WHERE o.id = p_order_id
    AND o.merchant_id = p_merchant_id
  FOR UPDATE;
  IF FOUND AND lower(btrim(COALESCE(v_payment_status, ''))) = 'refunded' THEN
    RAISE EXCEPTION 'order_refunded_for_shipment';
  END IF;
  -- Guest/authenticated cancels set payment_status = 'cancelled' while
  -- legacy merchant/customer cancels set shipping_status = 'cancelled'
  -- (payment may stay paid), and every cancel path restocks inventory.
  -- Booking either representation would ship against stock already
  -- returned to sale. Both spellings are rejected: merchant
  -- cancellation guards accept 'canceled' too.
  IF FOUND AND (
    lower(btrim(COALESCE(v_payment_status, ''))) IN ('cancelled', 'canceled')
    OR lower(btrim(COALESCE(v_shipping_status, ''))) IN ('cancelled', 'canceled')
  ) THEN
    RAISE EXCEPTION 'order_cancelled_for_shipment';
  END IF;
  -- REDVAULT is prepaid: booking an unpaid REDVAULT order would create a
  -- provider shipment the shopper can still abandon at the hosted
  -- gateway. The method is read under the same advisory + row lock as the
  -- statuses above, so a concurrent payment confirmation and this claim
  -- serialize instead of racing. Other rails keep their existing
  -- behavior: pay-on-delivery legitimately books unpaid.
  IF FOUND
    AND lower(btrim(COALESCE(v_payment_method, ''))) = 'uba_redvault'
    AND lower(btrim(COALESCE(v_payment_status, ''))) <> 'paid' THEN
    RAISE EXCEPTION 'order_redvault_unpaid_for_shipment';
  END IF;

  -- Partial refunds leave payment_status paid, so the refunded check above
  -- cannot see them: a merchandise refund that is still settling (or
  -- processed but not yet inventory-reconciled) would finalize against the
  -- lock token this claim sets, defer to review without updating
  -- fulfillmentQuantity, and let the booking ship stale pre-refund units.
  -- The helper is SECURITY DEFINER because this claim runs as the caller
  -- (service_role or merchant), which has no grant on the private refund
  -- tables.
  IF private.uba_redvault_partial_refund_blocks_booking(p_order_id) THEN
    RAISE EXCEPTION 'order_refund_pending_for_shipment';
  END IF;

  UPDATE public.orders AS target
  SET shipment_booking_lock_token = p_lock_token,
      shipment_booking_started_at = pg_catalog.now()
  WHERE target.id = p_order_id
    AND target.merchant_id = p_merchant_id
    AND target.shipment_id IS NULL
    AND target.tracking_number IS NULL
    AND (
      target.shipment_booking_lock_token IS NULL
      OR target.shipment_booking_started_at IS NULL
      OR target.shipment_booking_started_at <
        pg_catalog.now() - pg_catalog.make_interval(
          secs => greatest(coalesce(p_lock_timeout_seconds, 900), 900)
        )
    );

  IF FOUND THEN
    RETURN QUERY
    SELECT true, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT false, target.shipment_id, target.tracking_number,
    target.shipping_status
  FROM public.orders AS target
  WHERE target.id = p_order_id
    AND target.merchant_id = p_merchant_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.assert_shippable_order_payment(
  p_order_id uuid,
  p_merchant_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_payment_method text;
  v_payment_status text;
  v_shipping_status text;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.has_merchant_access(p_merchant_id) THEN
    RAISE EXCEPTION 'forbidden_assert_shippable_order_payment'
      USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );
  SELECT o.payment_method, o.payment_status, o.shipping_status
  INTO v_payment_method, v_payment_status, v_shipping_status
  FROM public.orders AS o
  WHERE o.id = p_order_id AND o.merchant_id = p_merchant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found_for_shipment';
  END IF;
  IF lower(btrim(COALESCE(v_payment_status, ''))) = 'refunded' THEN
    RAISE EXCEPTION 'order_refunded_for_shipment';
  END IF;
  -- Same cancelled-order rejection as the booking claim: a cancel that
  -- lands between the claim and provider submission restocks inventory,
  -- so the pre-submit check must fail closed too.
  IF lower(btrim(COALESCE(v_payment_status, ''))) IN ('cancelled', 'canceled')
    OR lower(btrim(COALESCE(v_shipping_status, ''))) IN ('cancelled', 'canceled') THEN
    RAISE EXCEPTION 'order_cancelled_for_shipment';
  END IF;
  -- Same REDVAULT prepaid rejection as the booking claim: an unpaid
  -- REDVAULT order must fail closed at pre-submit time too.
  IF lower(btrim(COALESCE(v_payment_method, ''))) = 'uba_redvault'
    AND lower(btrim(COALESCE(v_payment_status, ''))) <> 'paid' THEN
    RAISE EXCEPTION 'order_redvault_unpaid_for_shipment';
  END IF;
END;
$function$;
