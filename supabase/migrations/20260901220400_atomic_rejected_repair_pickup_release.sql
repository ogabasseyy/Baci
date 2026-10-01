-- Release a locally reserved repair pickup only after GIGL has definitively
-- rejected the booking. The repair link, lock, and pending shipment must change
-- in one transaction so retries cannot create orphaned reservations.

CREATE OR REPLACE FUNCTION public.release_rejected_repair_pickup_reservation(
  p_repair_id uuid,
  p_merchant_id uuid,
  p_shipment_id uuid,
  p_lock_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_repair_found boolean := false;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.check_staff_permission(
       (SELECT auth.uid()),
       p_merchant_id,
       'repairs',
       'edit'
     ) THEN
    RAISE EXCEPTION 'forbidden_release_rejected_repair_pickup_reservation'
      USING ERRCODE = '42501';
  END IF;

  SELECT true
  INTO v_repair_found
  FROM public.repairs AS repair
  WHERE repair.id = p_repair_id
    AND repair.merchant_id = p_merchant_id
    AND repair.shipment_id = p_shipment_id
    AND repair.pickup_booking_lock_token = p_lock_token
  FOR UPDATE;

  IF NOT v_repair_found THEN
    RETURN false;
  END IF;

  DELETE FROM public.shipments AS shipment
  WHERE shipment.id = p_shipment_id
    AND shipment.merchant_id = p_merchant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rejected_repair_pickup_shipment_not_found';
  END IF;

  -- The tenant-scoped FK sets shipment_id to NULL during DELETE. Clear the
  -- matching booking lock while the repair row remains locked in this function.
  UPDATE public.repairs AS repair
  SET pickup_booking_lock_token = NULL,
      pickup_booking_started_at = NULL
  WHERE repair.id = p_repair_id
    AND repair.merchant_id = p_merchant_id
    AND repair.shipment_id IS NULL
    AND repair.pickup_booking_lock_token = p_lock_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rejected_repair_pickup_lock_not_cleared';
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.release_rejected_repair_pickup_reservation(
  uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_rejected_repair_pickup_reservation(
  uuid, uuid, uuid, uuid
) TO authenticated, service_role;

COMMENT ON FUNCTION public.release_rejected_repair_pickup_reservation(
  uuid, uuid, uuid, uuid
) IS
  'Atomically removes a locally reserved shipment after a definitive provider rejection and clears the matching repair pickup lock.';
