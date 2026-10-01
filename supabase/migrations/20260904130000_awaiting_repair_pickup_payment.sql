-- Distinguish unpaid storefront pickups from legacy null/null rows.
-- New paid-pickup starts mark awaiting_payment so dashboard booking cannot
-- race ahead of Paystack confirmation. Confirm still transitions null-reference
-- rows (including awaiting_payment) to paid/review.

ALTER TABLE public.repairs
  DROP CONSTRAINT IF EXISTS repairs_pickup_payment_status_check;
ALTER TABLE public.repairs
  ADD CONSTRAINT repairs_pickup_payment_status_check CHECK (
    pickup_payment_status IS NULL
    OR pickup_payment_status IN (
      'awaiting_payment',
      'paid',
      'booking',
      'booked',
      'retrying',
      'review'
    )
  );

CREATE OR REPLACE FUNCTION public.mark_repair_pickup_awaiting_payment(
  p_repair_id uuid,
  p_merchant_id uuid
)
RETURNS TABLE (marked boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_repair_id IS NULL OR p_merchant_id IS NULL THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  IF COALESCE(auth.jwt() ->> 'repair_pickup_receiver_context', '')
      IS DISTINCT FROM 'server-quote'
    OR COALESCE(
      auth.jwt() ->> 'repair_pickup_receiver_merchant_id',
      ''
    ) IS DISTINCT FROM p_merchant_id::text
  THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  UPDATE public.repairs AS repair
  SET pickup_payment_status = 'awaiting_payment'
  WHERE repair.id = p_repair_id
    AND repair.merchant_id = p_merchant_id
    AND repair.service_type = 'pickup'
    AND repair.pickup_payment_reference IS NULL
    AND repair.shipment_id IS NULL
    AND (
      repair.pickup_payment_status IS NULL
      OR repair.pickup_payment_status = 'awaiting_payment'
    );

  RETURN QUERY SELECT FOUND;
END;
$$;

COMMENT ON FUNCTION public.mark_repair_pickup_awaiting_payment(uuid, uuid) IS
  'Server-capability-only mark of an unpaid pickup repair as awaiting_payment before Paystack init; idempotent for already-awaiting rows.';

REVOKE ALL ON FUNCTION public.mark_repair_pickup_awaiting_payment(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, repair_pickup_receiver;
GRANT EXECUTE ON FUNCTION public.mark_repair_pickup_awaiting_payment(uuid, uuid)
  TO repair_pickup_receiver;

NOTIFY pgrst, 'reload schema';
