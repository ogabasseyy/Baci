-- Refuse atomic pickup claims when the merchant already recorded offline
-- fulfillment (pickup_payment_status = manual_fulfilled). Automatic booking may
-- have read a paid repair and be mid-quote while the merchant marks manual
-- fulfillment; the claim RPC must fail closed like terminal repair status.

DROP FUNCTION IF EXISTS public.claim_repair_pickup_booking(uuid, uuid, uuid, integer);

CREATE FUNCTION public.claim_repair_pickup_booking(
  p_repair_id uuid,
  p_merchant_id uuid,
  p_lock_token uuid,
  p_lock_timeout_seconds integer DEFAULT 900
)
RETURNS TABLE(
  claimed boolean,
  shipment_id uuid,
  terminal boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.check_staff_permission(
       (SELECT auth.uid()),
       p_merchant_id,
       'repairs',
       'edit'
     ) THEN
    RAISE EXCEPTION 'forbidden_claim_repair_pickup_booking'
      USING ERRCODE = '42501';
  END IF;

  -- Alias + qualify every predicate column: `shipment_id` is also an OUT column
  -- of this function, so an unqualified reference is ambiguous under the default
  -- plpgsql.variable_conflict = error (SQLSTATE 42702).
  UPDATE public.repairs AS r
  SET pickup_booking_lock_token = p_lock_token,
      pickup_booking_started_at = now()
  WHERE r.id = p_repair_id
    AND r.merchant_id = p_merchant_id
    AND r.shipment_id IS NULL
    AND r.status NOT IN ('completed', 'cancelled', 'rejected')
    AND r.pickup_payment_status IS DISTINCT FROM 'manual_fulfilled'
    AND (
      r.pickup_booking_lock_token IS NULL
      OR r.pickup_booking_started_at IS NULL
      OR r.pickup_booking_started_at <
        now() - make_interval(secs => greatest(p_lock_timeout_seconds, 0))
    );

  IF FOUND THEN
    RETURN QUERY
    SELECT true, NULL::uuid, false;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT false,
         r.shipment_id,
         (
           r.status IN ('completed', 'cancelled', 'rejected')
           OR r.pickup_payment_status = 'manual_fulfilled'
         ) AS terminal
  FROM public.repairs AS r
  WHERE r.id = p_repair_id
    AND r.merchant_id = p_merchant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_repair_pickup_booking(uuid, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_repair_pickup_booking(uuid, uuid, uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.claim_repair_pickup_booking(uuid, uuid, uuid, integer) IS
  'Atomically claims provider-backed pickup booking for a repair, failing closed on terminal repair status or manual_fulfilled pickup payment, and reports already-booked/in-progress/terminal state.';

NOTIFY pgrst, 'reload schema';
