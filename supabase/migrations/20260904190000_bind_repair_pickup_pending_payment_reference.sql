-- Bind Paystack RPU references to repairs before initializeTransaction so
-- claim-invalid webhooks can ledger mismatches only against a trusted pending
-- binding — never unsigned metadata merchant/repair UUIDs.

ALTER TABLE public.repairs
  ADD COLUMN IF NOT EXISTS pickup_payment_pending_reference text;

CREATE UNIQUE INDEX IF NOT EXISTS
  repairs_pickup_payment_pending_reference_unique_idx
  ON public.repairs (pickup_payment_pending_reference)
  WHERE pickup_payment_pending_reference IS NOT NULL;

COMMENT ON COLUMN public.repairs.pickup_payment_pending_reference IS
  'Paystack reference reserved for an unpaid pickup before confirmation; distinct from pickup_payment_reference which means paid.';

CREATE OR REPLACE FUNCTION public.bind_repair_pickup_pending_payment_reference(
  p_repair_id uuid,
  p_merchant_id uuid,
  p_reference text
)
RETURNS TABLE (bound boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_repair_id IS NULL OR p_merchant_id IS NULL THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  IF p_reference IS NULL OR p_reference !~ '^RPU-[A-Z0-9]{16}$' THEN
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
  SET pickup_payment_pending_reference = p_reference
  WHERE repair.id = p_repair_id
    AND repair.merchant_id = p_merchant_id
    AND repair.service_type = 'pickup'
    AND repair.pickup_payment_reference IS NULL
    AND repair.shipment_id IS NULL
    AND repair.pickup_payment_status = 'awaiting_payment';

  RETURN QUERY SELECT FOUND;
END;
$$;

COMMENT ON FUNCTION public.bind_repair_pickup_pending_payment_reference(
  uuid, uuid, text
) IS
  'Server-capability-only bind of a pending Paystack RPU reference before initializeTransaction; overwrites prior pending refs on retry.';

REVOKE ALL ON FUNCTION public.bind_repair_pickup_pending_payment_reference(
  uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role, repair_pickup_receiver;
GRANT EXECUTE ON FUNCTION public.bind_repair_pickup_pending_payment_reference(
  uuid, uuid, text
) TO repair_pickup_receiver;

NOTIFY pgrst, 'reload schema';
