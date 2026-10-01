-- Persist verified Paystack repair-pickup charges that fail claim validation
-- (signature / amount / currency / reference mismatch, or missing claim) so the
-- webhook can ACK only after a durable ledger row exists for ops review.
CREATE OR REPLACE FUNCTION public.record_repair_pickup_payment_mismatch(
  p_reference text,
  p_amount numeric,
  p_currency text,
  p_gateway_response jsonb,
  p_merchant_id uuid,
  p_repair_id uuid,
  p_mismatch_reason text
)
RETURNS TABLE(recorded boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_existing_id uuid;
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_reason text := nullif(btrim(coalesce(p_mismatch_reason, '')), '');
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden_record_repair_pickup_payment_mismatch'
      USING ERRCODE = '42501';
  END IF;
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'invalid_repair_pickup_identity'
      USING ERRCODE = '22023';
  END IF;
  IF p_reference IS NULL
     OR btrim(p_reference) = ''
     OR char_length(p_reference) > 100
     OR p_reference !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'invalid_repair_pickup_reference'
      USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 10000000 THEN
    RAISE EXCEPTION 'invalid_repair_pickup_amount'
      USING ERRCODE = '22023';
  END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'invalid_repair_pickup_currency'
      USING ERRCODE = '22023';
  END IF;
  IF p_gateway_response IS NULL OR jsonb_typeof(p_gateway_response) <> 'object' THEN
    RAISE EXCEPTION 'invalid_repair_pickup_gateway_response'
      USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) > 100 THEN
    RAISE EXCEPTION 'invalid_repair_pickup_mismatch_reason'
      USING ERRCODE = '22023';
  END IF;

  SELECT t.id
  INTO v_existing_id
  FROM public.transactions AS t
  WHERE t.gateway = 'paystack'
    AND t.gateway_reference = p_reference
    AND t.metadata ->> 'transaction_type' = 'repair_pickup'
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    IF p_repair_id IS NOT NULL THEN
      UPDATE public.repairs AS repair
      SET pickup_payment_status = 'review'
      WHERE repair.id = p_repair_id
        AND repair.merchant_id = p_merchant_id
        AND coalesce(repair.pickup_payment_status, '') <> 'booked';
    END IF;
    RETURN QUERY SELECT false;
    RETURN;
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
    v_currency,
    'completed',
    'paystack',
    p_reference,
    p_gateway_response,
    'Customer-funded GIGL repair pickup (claim mismatch)',
    jsonb_build_object(
      'transaction_type', 'repair_pickup',
      'claim_mismatch', true,
      'mismatch_reason', v_reason,
      'repair_id', p_repair_id
    ),
    0,
    0
  );

  IF p_repair_id IS NOT NULL THEN
    UPDATE public.repairs AS repair
    SET pickup_payment_status = 'review'
    WHERE repair.id = p_repair_id
      AND repair.merchant_id = p_merchant_id
      AND coalesce(repair.pickup_payment_status, '') <> 'booked';
  END IF;

  RETURN QUERY SELECT true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_repair_pickup_payment_mismatch(
  text, numeric, text, jsonb, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_repair_pickup_payment_mismatch(
  text, numeric, text, jsonb, uuid, uuid, text
) TO service_role;

COMMENT ON FUNCTION public.record_repair_pickup_payment_mismatch(
  text, numeric, text, jsonb, uuid, uuid, text
) IS
  'Atomically ledgers a verified Paystack repair-pickup charge that failed claim validation, optionally marking the repair for review. Service-role webhook only; duplicate references are idempotent.';
