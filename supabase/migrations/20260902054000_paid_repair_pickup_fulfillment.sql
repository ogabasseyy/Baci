-- Customer-funded reverse logistics for repair pickups. Payment confirmation
-- is service-role-only and atomic; GIGL booking happens only after this state
-- has been committed by the verified payment webhook.

ALTER TABLE public.repairs
  ADD COLUMN IF NOT EXISTS pickup_payment_status text,
  ADD COLUMN IF NOT EXISTS pickup_payment_reference text,
  ADD COLUMN IF NOT EXISTS pickup_fee numeric(12, 2),
  ADD COLUMN IF NOT EXISTS pickup_currency text,
  ADD COLUMN IF NOT EXISTS pickup_paid_at timestamptz;

ALTER TABLE public.repairs
  DROP CONSTRAINT IF EXISTS repairs_pickup_payment_status_check;
ALTER TABLE public.repairs
  ADD CONSTRAINT repairs_pickup_payment_status_check CHECK (
    pickup_payment_status IS NULL
    OR pickup_payment_status IN (
      'paid', 'booking', 'booked', 'retrying', 'review'
    )
  );

CREATE OR REPLACE FUNCTION public.confirm_repair_pickup_payment(
  p_repair_id uuid,
  p_merchant_id uuid,
  p_reference text,
  p_amount numeric,
  p_currency text,
  p_gateway_response jsonb
)
RETURNS TABLE(confirmed boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_repair public.repairs%ROWTYPE;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden_confirm_repair_pickup_payment'
      USING ERRCODE = '42501';
  END IF;
  IF p_repair_id IS NULL OR p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'invalid_repair_pickup_identity'
      USING ERRCODE = '22023';
  END IF;
  IF p_reference IS NULL OR p_reference !~ '^RPU-[A-Z0-9]{16}$' THEN
    RAISE EXCEPTION 'invalid_repair_pickup_reference'
      USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 10000000 THEN
    RAISE EXCEPTION 'invalid_repair_pickup_amount'
      USING ERRCODE = '22023';
  END IF;
  IF upper(btrim(coalesce(p_currency, ''))) <> 'NGN' THEN
    RAISE EXCEPTION 'invalid_repair_pickup_currency'
      USING ERRCODE = '22023';
  END IF;
  IF p_gateway_response IS NULL OR jsonb_typeof(p_gateway_response) <> 'object' THEN
    RAISE EXCEPTION 'invalid_repair_pickup_gateway_response'
      USING ERRCODE = '22023';
  END IF;

  SELECT repair.*
  INTO v_repair
  FROM public.repairs AS repair
  WHERE repair.id = p_repair_id
    AND repair.merchant_id = p_merchant_id
  FOR UPDATE;

  IF NOT FOUND OR coalesce(v_repair.service_type, '') <> 'pickup' THEN
    RAISE EXCEPTION 'repair_pickup_not_found'
      USING ERRCODE = 'P0002';
  END IF;
  IF coalesce(v_repair.status::text, '') IN (
    'completed', 'cancelled', 'rejected'
  ) THEN
    RAISE EXCEPTION 'repair_pickup_terminal'
      USING ERRCODE = '22023';
  END IF;

  IF v_repair.pickup_payment_reference IS NOT NULL THEN
    IF v_repair.pickup_payment_reference = p_reference
       AND v_repair.pickup_fee = p_amount
       AND v_repair.pickup_currency = 'NGN'
       AND v_repair.pickup_payment_status IN (
         'paid', 'booking', 'booked', 'retrying', 'review'
       ) THEN
      RETURN QUERY SELECT false;
      RETURN;
    END IF;
    RAISE EXCEPTION 'repair_pickup_payment_conflict'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.transactions (
    merchant_id,
    order_id,
    transaction_type,
    amount,
    currency,
    status,
    gateway,
    gateway_reference,
    gateway_response,
    description,
    metadata,
    platform_fee,
    merchant_amount
  )
  VALUES (
    p_merchant_id,
    NULL,
    'payment',
    p_amount,
    'NGN',
    'completed',
    'paystack',
    p_reference,
    p_gateway_response,
    'Customer-funded GIGL repair pickup',
    jsonb_build_object(
      'transaction_type', 'repair_pickup',
      'repair_id', p_repair_id
    ),
    0,
    0
  );

  UPDATE public.repairs AS repair
  SET pickup_payment_status = 'paid',
      pickup_payment_reference = p_reference,
      pickup_fee = p_amount,
      pickup_currency = 'NGN',
      pickup_paid_at = now()
  WHERE repair.id = p_repair_id
    AND repair.merchant_id = p_merchant_id;

  RETURN QUERY SELECT true;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_repair_pickup_payment(
  uuid, uuid, text, numeric, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_repair_pickup_payment(
  uuid, uuid, text, numeric, text, jsonb
) TO service_role;

COMMENT ON FUNCTION public.confirm_repair_pickup_payment(
  uuid, uuid, text, numeric, text, jsonb
) IS
  'Atomically records a verified customer-funded repair pickup payment. Service-role webhook only; duplicate references are idempotent.';

-- Extend the enumeration-safe customer status snapshot with the pickup payment
-- state. The merchant + ticket + email guard and DB-side throttle are retained.
DROP FUNCTION IF EXISTS public.get_repair_status(uuid, integer, text);

CREATE FUNCTION public.get_repair_status(
  p_merchant_id uuid,
  p_ticket_number integer,
  p_email text
)
RETURNS TABLE (
  ticket_number integer,
  status public.repair_status,
  device_type text,
  device_model text,
  repair_type_label text,
  service_type text,
  created_at timestamptz,
  updated_at timestamptz,
  tracking_number text,
  pickup_payment_status text,
  pickup_fee numeric,
  pickup_currency text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_allowed boolean := true;
BEGIN
  IF p_merchant_id IS NULL OR p_ticket_number IS NULL OR v_email = '' THEN
    RETURN;
  END IF;

  BEGIN
    v_allowed := public.check_rate_limit(
      'repair-status:' || p_merchant_id::text || ':' || v_email,
      'repair_status_rpc',
      60,
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
    repair.ticket_number,
    repair.status,
    repair.device_type,
    repair.device_model,
    repair.repair_type_label,
    repair.service_type,
    repair.created_at,
    repair.updated_at,
    shipment.tracking_number,
    repair.pickup_payment_status,
    repair.pickup_fee,
    repair.pickup_currency
  FROM public.repairs AS repair
  LEFT JOIN public.shipments AS shipment ON shipment.id = repair.shipment_id
  WHERE repair.merchant_id = p_merchant_id
    AND repair.ticket_number = p_ticket_number
    AND lower(repair.customer_email) = v_email;
END;
$$;

COMMENT ON FUNCTION public.get_repair_status(uuid, integer, text) IS
  'Enumeration-safe repair status lookup including customer-funded pickup payment and GIGL tracking state.';

REVOKE ALL ON FUNCTION public.get_repair_status(uuid, integer, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_repair_status(uuid, integer, text)
  TO anon, authenticated, service_role;
