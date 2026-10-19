-- Consume pending-reference history rows on confirm and mismatch ledger writes.
-- Clears the tip column only when it matches the paid/mismatched reference so
-- a newer retry tip is preserved when an older Paystack link settles.

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
  v_terminal boolean := false;
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

  v_terminal := coalesce(v_repair.status::text, '') IN (
    'completed', 'cancelled', 'rejected'
  );

  IF v_repair.pickup_payment_reference IS NOT NULL THEN
    IF v_repair.pickup_payment_reference = p_reference
       AND v_repair.pickup_fee = p_amount
       AND v_repair.pickup_currency = 'NGN'
       AND v_repair.pickup_payment_status IN (
         'paid', 'booking', 'booked', 'retrying', 'review', 'manual_fulfilled'
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
    CASE
      WHEN v_terminal THEN 'Customer-funded GIGL repair pickup (terminal repair)'
      ELSE 'Customer-funded GIGL repair pickup'
    END,
    jsonb_build_object(
      'transaction_type', 'repair_pickup',
      'repair_id', p_repair_id,
      'terminal_at_capture', v_terminal
    ),
    0,
    0
  );

  UPDATE public.repairs AS repair
  SET pickup_payment_status = CASE
        WHEN v_terminal THEN 'review'
        ELSE 'paid'
      END,
      pickup_payment_reference = p_reference,
      pickup_payment_pending_reference = CASE
        WHEN repair.pickup_payment_pending_reference = p_reference THEN NULL
        ELSE repair.pickup_payment_pending_reference
      END,
      pickup_fee = p_amount,
      pickup_currency = 'NGN',
      pickup_paid_at = now()
  WHERE repair.id = p_repair_id
    AND repair.merchant_id = p_merchant_id;

  UPDATE public.repair_pickup_pending_payment_references AS pending
  SET consumed_at = now()
  WHERE pending.reference = p_reference
    AND pending.repair_id = p_repair_id
    AND pending.merchant_id = p_merchant_id
    AND pending.consumed_at IS NULL;

  RETURN QUERY SELECT true;
END;
$$;

COMMENT ON FUNCTION public.confirm_repair_pickup_payment(
  uuid, uuid, text, numeric, text, jsonb
) IS
  'Atomically records a verified customer-funded repair pickup payment, consumes the matching pending reference history row, clears the tip when it matches, and includes late captures after the repair became terminal. Service-role webhook only; duplicate references are idempotent.';

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
      SET pickup_payment_status = 'review',
          pickup_payment_pending_reference = CASE
            WHEN repair.pickup_payment_pending_reference = p_reference THEN NULL
            ELSE repair.pickup_payment_pending_reference
          END
      WHERE repair.id = p_repair_id
        AND repair.merchant_id = p_merchant_id
        AND coalesce(repair.pickup_payment_status, '') NOT IN (
          'booked', 'manual_fulfilled'
        );

      UPDATE public.repair_pickup_pending_payment_references AS pending
      SET consumed_at = now()
      WHERE pending.reference = p_reference
        AND pending.repair_id = p_repair_id
        AND pending.merchant_id = p_merchant_id
        AND pending.consumed_at IS NULL;
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
    SET pickup_payment_status = 'review',
        pickup_payment_pending_reference = CASE
          WHEN repair.pickup_payment_pending_reference = p_reference THEN NULL
          ELSE repair.pickup_payment_pending_reference
        END
    WHERE repair.id = p_repair_id
      AND repair.merchant_id = p_merchant_id
      AND coalesce(repair.pickup_payment_status, '') NOT IN (
        'booked', 'manual_fulfilled'
      );

    UPDATE public.repair_pickup_pending_payment_references AS pending
    SET consumed_at = now()
    WHERE pending.reference = p_reference
      AND pending.repair_id = p_repair_id
      AND pending.merchant_id = p_merchant_id
      AND pending.consumed_at IS NULL;
  END IF;

  RETURN QUERY SELECT true;
END;
$$;

COMMENT ON FUNCTION public.record_repair_pickup_payment_mismatch(
  text, numeric, text, jsonb, uuid, uuid, text
) IS
  'Atomically ledgers a verified Paystack repair-pickup charge that failed claim validation, marks the repair for review (unless booked/manual_fulfilled), and consumes the matching pending reference history row. Service-role webhook only; duplicate references are idempotent.';
