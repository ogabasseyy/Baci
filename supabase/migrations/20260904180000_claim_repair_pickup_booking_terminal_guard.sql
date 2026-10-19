-- Re-assert terminal status filtering on claim_repair_pickup_booking for the
-- paid-pickup apply path. Older claim shapes (no terminal OUT column / no
-- status predicate) left cancelled/completed/rejected repairs claimable;
-- TypeScript already expects terminal=true. Changing RETURNS TABLE requires
-- DROP + CREATE.

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
         (r.status IN ('completed', 'cancelled', 'rejected')) AS terminal
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
  'Atomically claims provider-backed pickup booking for a repair, failing closed on terminal status, and reports already-booked/in-progress/terminal state.';

NOTIFY pgrst, 'reload schema';
