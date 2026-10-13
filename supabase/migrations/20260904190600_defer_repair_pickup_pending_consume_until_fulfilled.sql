-- Keep pending Paystack reference history rows available after capture confirm
-- until pickup fulfillment is terminal (booked / manual_fulfilled). That way a
-- later Paystack redelivery after PAYSTACK_SECRET_KEY rotation can still bind
-- via pending history (or pickup_payment_reference) while status is retrying.

CREATE OR REPLACE FUNCTION private.consume_repair_pickup_pending_payment_references(
  p_repair_id uuid,
  p_merchant_id uuid,
  p_reference text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_repair_id IS NULL
     OR p_merchant_id IS NULL
     OR p_reference IS NULL
     OR btrim(p_reference) = '' THEN
    RETURN;
  END IF;

  UPDATE public.repair_pickup_pending_payment_references AS pending
  SET consumed_at = now()
  WHERE pending.reference = p_reference
    AND pending.repair_id = p_repair_id
    AND pending.merchant_id = p_merchant_id
    AND pending.consumed_at IS NULL;
END;
$$;

ALTER FUNCTION private.consume_repair_pickup_pending_payment_references(
  uuid, uuid, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.consume_repair_pickup_pending_payment_references(
  uuid, uuid, text
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.consume_repair_pickup_pending_on_fulfilled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.pickup_payment_status IN ('booked', 'manual_fulfilled')
     AND NEW.pickup_payment_status IS DISTINCT FROM OLD.pickup_payment_status
     AND NEW.pickup_payment_reference IS NOT NULL THEN
    PERFORM private.consume_repair_pickup_pending_payment_references(
      NEW.id,
      NEW.merchant_id,
      NEW.pickup_payment_reference
    );
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION private.consume_repair_pickup_pending_on_fulfilled()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.consume_repair_pickup_pending_on_fulfilled()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS consume_repair_pickup_pending_on_fulfilled
  ON public.repairs;
CREATE TRIGGER consume_repair_pickup_pending_on_fulfilled
  AFTER UPDATE OF pickup_payment_status ON public.repairs
  FOR EACH ROW
  EXECUTE FUNCTION private.consume_repair_pickup_pending_on_fulfilled();

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
  v_preserve_status text;
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
  v_preserve_status := CASE
    WHEN v_repair.pickup_payment_status IN ('manual_fulfilled', 'booked')
      THEN v_repair.pickup_payment_status
    ELSE NULL
  END;

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
      WHEN v_preserve_status = 'manual_fulfilled' THEN
        'Customer-funded GIGL repair pickup (manual fulfillment)'
      WHEN v_preserve_status = 'booked' THEN
        'Customer-funded GIGL repair pickup (already booked)'
      WHEN v_terminal THEN
        'Customer-funded GIGL repair pickup (terminal repair)'
      ELSE
        'Customer-funded GIGL repair pickup'
    END,
    jsonb_build_object(
      'transaction_type', 'repair_pickup',
      'repair_id', p_repair_id,
      'terminal_at_capture', v_terminal,
      'preserved_pickup_payment_status', to_jsonb(v_preserve_status)
    ),
    0,
    0
  );

  UPDATE public.repairs AS repair
  SET pickup_payment_status = CASE
        WHEN v_preserve_status IS NOT NULL THEN v_preserve_status
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

  -- Consume only when confirm preserves an already-terminal fulfillment status.
  -- Non-terminal paid/retrying captures keep pending history for redelivery bind.
  IF v_preserve_status IS NOT NULL THEN
    PERFORM private.consume_repair_pickup_pending_payment_references(
      p_repair_id,
      p_merchant_id,
      p_reference
    );
  END IF;

  RETURN QUERY SELECT true;
END;
$$;

COMMENT ON FUNCTION public.confirm_repair_pickup_payment(
  uuid, uuid, text, numeric, text, jsonb
) IS
  'Atomically records a verified customer-funded repair pickup payment, clears the matching tip, preserves manual_fulfilled/booked on late capture, and defers pending-reference consumption until booked/manual_fulfilled (unless already terminal). Service-role webhook only; duplicate references are idempotent.';
