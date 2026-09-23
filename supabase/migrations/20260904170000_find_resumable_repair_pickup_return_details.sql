-- Return pickup-relevant fields from find_resumable_repair_pickup so the
-- storefront can refuse reclaim when the customer edited device/phone/address
-- after the resume token was issued (payment would quote the new submission
-- against the old repair row).

DROP FUNCTION IF EXISTS public.find_resumable_repair_pickup(uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.find_resumable_repair_pickup(
  p_merchant_id uuid,
  p_customer_email text,
  p_repair_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  ticket_number integer,
  device_type text,
  device_model text,
  customer_phone text,
  pickup_address text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_customer_email, '')));
  v_allowed boolean := true;
BEGIN
  IF p_merchant_id IS NULL OR v_email = '' THEN
    RETURN;
  END IF;

  IF COALESCE(auth.jwt() ->> 'repair_pickup_receiver_context', '')
      IS DISTINCT FROM 'server-quote'
    OR COALESCE(
      auth.jwt() ->> 'repair_pickup_receiver_merchant_id',
      ''
    ) IS DISTINCT FROM p_merchant_id::text
  THEN
    RETURN;
  END IF;

  BEGIN
    v_allowed := public.check_rate_limit(
      'repair-resumable-pickup:' || p_merchant_id::text || ':' || v_email,
      'repair_resumable_pickup_rpc',
      30,
      60
    );
  EXCEPTION WHEN OTHERS THEN
    v_allowed := true;
  END;

  IF NOT v_allowed THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    repair.id,
    repair.ticket_number,
    repair.device_type,
    repair.device_model,
    repair.customer_phone,
    repair.pickup_address
  FROM public.repairs AS repair
  WHERE repair.merchant_id = p_merchant_id
    AND lower(repair.customer_email) = v_email
    AND repair.service_type = 'pickup'
    AND repair.pickup_payment_reference IS NULL
    AND repair.shipment_id IS NULL
    AND repair.status NOT IN ('completed', 'cancelled', 'rejected')
    AND repair.created_at >= (now() - interval '2 hours')
    AND (p_repair_id IS NULL OR repair.id = p_repair_id)
  ORDER BY repair.created_at DESC
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.find_resumable_repair_pickup(uuid, text, uuid) IS
  'Server-capability-only unpaid pickup repair reclaim; returns pickup fields for input binding; optional p_repair_id pins the resume claim ticket.';

REVOKE ALL ON FUNCTION public.find_resumable_repair_pickup(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role, repair_pickup_receiver;
GRANT EXECUTE ON FUNCTION public.find_resumable_repair_pickup(uuid, text, uuid)
  TO repair_pickup_receiver;

NOTIFY pgrst, 'reload schema';
