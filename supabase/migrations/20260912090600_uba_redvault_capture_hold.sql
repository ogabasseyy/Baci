ALTER TABLE private.uba_redvault_payment_attempts
  DROP CONSTRAINT IF EXISTS uba_redvault_payment_attempts_state_check;
ALTER TABLE private.uba_redvault_payment_attempts
  ADD CONSTRAINT uba_redvault_payment_attempts_state_check CHECK (
    state IN ('created', 'initializing', 'initialized', 'indeterminate',
      'capture_evidence_review', 'captured_held', 'approved', 'superseded', 'void')
  );

CREATE OR REPLACE FUNCTION public.capture_or_hold_uba_redvault_payment(
  p_transaction_id uuid,
  p_order_id uuid,
  p_gateway text,
  p_reference text,
  p_gateway_response jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_application private.uba_redvault_applications%ROWTYPE;
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_capture_amount bigint;
  v_capture_currency text;
  v_capture_reference text;
  v_capture_status text;
  v_duplicate boolean := false;
  v_capture_evidence_verified boolean := false;
  v_order_merchant_id uuid;
  v_order_payment_method text;
  v_order_total numeric;
  v_reason text := 'provider_eligibility_evidence_unavailable';
  v_transaction_amount numeric;
  v_transaction_currency text;
  v_transaction_gateway text;
  v_transaction_merchant_id uuid;
  v_transaction_order_id uuid;
  v_transaction_reference text;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: capture_or_hold_uba_redvault_payment requires service_role';
  END IF;

  IF p_transaction_id IS NULL OR p_order_id IS NULL OR p_gateway_response IS NULL THEN
    RAISE EXCEPTION 'redvault_capture_hold_invalid_arguments';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  SELECT t.order_id, t.merchant_id, t.gateway, t.gateway_reference,
    COALESCE(t.amount, 0), t.currency
  INTO v_transaction_order_id, v_transaction_merchant_id, v_transaction_gateway,
    v_transaction_reference, v_transaction_amount, v_transaction_currency
  FROM public.transactions AS t
  WHERE t.id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND OR v_transaction_order_id IS DISTINCT FROM p_order_id THEN
    RAISE EXCEPTION 'redvault_capture_transaction_order_mismatch';
  END IF;

  SELECT o.merchant_id, o.payment_method, COALESCE(o.total, 0)
  INTO v_order_merchant_id, v_order_payment_method, v_order_total
  FROM public.orders AS o
  WHERE o.id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'redvault_capture_order_not_found';
  END IF;

  IF v_order_payment_method IS DISTINCT FROM 'uba_redvault' THEN
    RETURN jsonb_build_object('kind', 'not_redvault');
  END IF;

  IF v_order_merchant_id <> '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
    OR v_transaction_merchant_id IS DISTINCT FROM v_order_merchant_id
    OR v_transaction_gateway IS DISTINCT FROM 'paystack'
    OR p_gateway IS DISTINCT FROM 'paystack' THEN
    RAISE EXCEPTION 'redvault_capture_transaction_mismatch';
  END IF;

  SELECT * INTO v_application
  FROM private.uba_redvault_applications AS application
  WHERE application.order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'redvault_capture_application_not_found';
  END IF;

  SELECT * INTO v_attempt
  FROM private.uba_redvault_payment_attempts AS a
  WHERE a.application_id = v_application.id
    AND a.reference = v_transaction_reference
  ORDER BY a.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'redvault_capture_attempt_not_found';
  END IF;

  v_capture_reference := p_gateway_response ->> 'reference';
  v_capture_currency := upper(p_gateway_response ->> 'currency');
  v_capture_status := lower(p_gateway_response ->> 'status');
  IF jsonb_typeof(p_gateway_response -> 'amount') = 'number'
    AND p_gateway_response ->> 'amount' ~ '^[0-9]+$' THEN
    v_capture_amount := (p_gateway_response ->> 'amount')::bigint;
  END IF;

  IF p_reference IS DISTINCT FROM v_transaction_reference
    OR v_capture_reference IS DISTINCT FROM v_transaction_reference
    OR v_capture_reference IS DISTINCT FROM v_attempt.reference THEN
    v_reason := 'capture_reference_mismatch';
  ELSIF v_capture_amount IS NULL
    OR v_capture_amount <> v_attempt.amount_kobo
    OR v_capture_amount <> round(v_transaction_amount * 100)::bigint
    OR v_capture_amount <> round(v_order_total * 100)::bigint THEN
    v_reason := 'capture_amount_mismatch';
  ELSIF v_capture_currency IS DISTINCT FROM v_attempt.currency
    OR v_capture_currency IS DISTINCT FROM upper(v_transaction_currency) THEN
    v_reason := 'capture_currency_mismatch';
  ELSIF v_capture_status IS DISTINCT FROM 'success' THEN
    v_reason := 'capture_status_not_success';
  ELSIF v_attempt.merchant_id IS DISTINCT FROM v_order_merchant_id
    OR v_application.order_id IS DISTINCT FROM p_order_id
    OR v_application.merchant_id IS DISTINCT FROM v_order_merchant_id
    OR v_application.quote_payload_hash IS DISTINCT FROM v_attempt.quote_payload_hash
    OR v_attempt.quote_payload_hash !~ '^[0-9a-f]{64}$' THEN
    v_reason := 'capture_quote_mismatch';
  END IF;

  v_capture_evidence_verified :=
    v_reason = 'provider_eligibility_evidence_unavailable';

  IF v_attempt.state = 'captured_held'
    AND v_attempt.provider_response IS NOT NULL THEN
    IF v_attempt.provider_response ->> 'capture_reference' IS DISTINCT FROM v_capture_reference
      OR v_attempt.provider_response ->> 'capture_amount_kobo' IS DISTINCT FROM v_capture_amount::text
      OR v_attempt.provider_response ->> 'capture_currency' IS DISTINCT FROM v_capture_currency THEN
      RAISE EXCEPTION 'redvault_capture_evidence_conflict';
    END IF;
    v_duplicate := true;
  ELSE
    UPDATE private.uba_redvault_payment_attempts
    SET state = CASE
        WHEN v_capture_evidence_verified THEN 'captured_held'
        ELSE 'capture_evidence_review'
      END,
      captured_at = CASE
        WHEN v_capture_evidence_verified THEN COALESCE(captured_at, now())
        ELSE NULL
      END,
      provider_response = jsonb_build_object(
        'capture_amount_kobo', v_capture_amount,
        'capture_currency', v_capture_currency,
        'capture_reference', v_capture_reference,
        'capture_status', v_capture_status,
        'capture_evidence_status', CASE
          WHEN v_capture_evidence_verified THEN 'verified_success'
          ELSE 'requires_review'
        END,
        'held_reason', v_reason,
        'quote_payload_hash', v_attempt.quote_payload_hash,
        'transaction_id', p_transaction_id
      )
    WHERE id = v_attempt.id;
  END IF;

  RETURN jsonb_build_object(
    'duplicate', v_duplicate,
    'kind', CASE
      WHEN v_capture_evidence_verified THEN 'captured_held'
      ELSE 'capture_evidence_review'
    END,
    'reason', v_reason
  );
END;
$$;

ALTER FUNCTION public.capture_or_hold_uba_redvault_payment(uuid, uuid, text, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.capture_or_hold_uba_redvault_payment(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capture_or_hold_uba_redvault_payment(uuid, uuid, text, text, jsonb) TO service_role;

COMMENT ON FUNCTION public.capture_or_hold_uba_redvault_payment(uuid, uuid, text, text, jsonb) IS
  'Service-role-only REDVAULT capture receipt. It validates the trusted transaction and frozen quote, records captured_held evidence, and never approves or settles the order.';
