-- The booking claim must keep caller privileges for its order SELECT/UPDATE.
-- Only the refund boolean lookup needs owner privileges: authenticated callers
-- have no private-schema USAGE and the private helper has no client grants.
BEGIN;

CREATE OR REPLACE FUNCTION public.order_shipment_refund_blocks_booking(
  p_order_id uuid,
  p_merchant_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- This probe is independently callable, so it must authorize the caller
  -- itself. Match the owner/orders:edit permission required by order UPDATE
  -- RLS; merchant membership alone also includes read-only staff.
  IF p_order_id IS NULL OR p_merchant_id IS NULL
    OR COALESCE(auth.role(), '') NOT IN ('authenticated', 'service_role')
    OR (
      auth.role() IS DISTINCT FROM 'service_role'
      AND (
        auth.uid() IS NULL
        OR NOT COALESCE(public.check_staff_permission(
          auth.uid(), p_merchant_id, 'orders', 'edit'
        ), false)
      )
    ) THEN
    RAISE EXCEPTION 'forbidden_order_shipment_refund_probe'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.orders AS target
    WHERE target.id = p_order_id AND target.merchant_id = p_merchant_id
  ) THEN
    RAISE EXCEPTION 'forbidden_order_shipment_refund_probe'
      USING ERRCODE = '42501';
  END IF;

  RETURN private.uba_redvault_partial_refund_blocks_booking(p_order_id);
END;
$function$;

ALTER FUNCTION public.order_shipment_refund_blocks_booking(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.order_shipment_refund_blocks_booking(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.order_shipment_refund_blocks_booking(uuid, uuid)
  TO authenticated, service_role;
COMMENT ON FUNCTION public.order_shipment_refund_blocks_booking(uuid, uuid) IS
  'Authorized, read-only shipment refund probe; order lock writes remain subject to caller RLS.';

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
  IF COALESCE(auth.role(), '') NOT IN ('authenticated', 'service_role')
    OR (
      auth.role() IS DISTINCT FROM 'service_role'
      AND (
        auth.uid() IS NULL
        OR NOT COALESCE(public.has_merchant_access(p_merchant_id), false)
      )
    ) THEN
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
  WHERE o.id = p_order_id AND o.merchant_id = p_merchant_id
  FOR UPDATE;

  -- Preserve the empty RPC result for absent or RLS-inaccessible orders.
  -- Never invoke the privileged probe for an order the caller cannot lock.
  IF NOT FOUND THEN RETURN; END IF;

  IF lower(btrim(COALESCE(v_payment_status, ''))) = 'refunded' THEN
    RAISE EXCEPTION 'order_refunded_for_shipment';
  END IF;
  IF lower(btrim(COALESCE(v_payment_status, ''))) IN ('cancelled', 'canceled')
    OR lower(btrim(COALESCE(v_shipping_status, ''))) IN ('cancelled', 'canceled') THEN
    RAISE EXCEPTION 'order_cancelled_for_shipment';
  END IF;
  IF lower(btrim(COALESCE(v_payment_method, ''))) = 'uba_redvault'
    AND lower(btrim(COALESCE(v_payment_status, ''))) <> 'paid' THEN
    RAISE EXCEPTION 'order_redvault_unpaid_for_shipment';
  END IF;

  -- Runs under the same advisory and order row locks as payment checks.
  IF public.order_shipment_refund_blocks_booking(p_order_id, p_merchant_id) THEN
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
    RETURN QUERY SELECT true, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT false, target.shipment_id, target.tracking_number, target.shipping_status
  FROM public.orders AS target
  WHERE target.id = p_order_id AND target.merchant_id = p_merchant_id;
END;
$function$;

-- CREATE OR REPLACE preserves the existing public RPC grants and ownership.
NOTIFY pgrst, 'reload schema';
COMMIT;
