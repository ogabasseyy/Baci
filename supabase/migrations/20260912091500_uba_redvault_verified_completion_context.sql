CREATE OR REPLACE FUNCTION private.redvault_attempt_filter_policy_valid(
  p_policy jsonb,
  p_policy_hash text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    jsonb_typeof(p_policy) = 'object'
    AND p_policy_hash ~ '^[0-9a-f]{64}$'
    AND p_policy_hash = encode(extensions.digest(p_policy::text, 'sha256'), 'hex')
    AND jsonb_typeof(p_policy->'bankCode') = 'string'
    AND p_policy->>'bankCode' ~ '^[0-9]{3}$'
    AND jsonb_typeof(p_policy->'issuerName') = 'string'
    AND NULLIF(p_policy->>'issuerName', '') IS NOT NULL
    AND jsonb_typeof(p_policy->'verificationDomain') = 'string'
    AND p_policy->>'verificationDomain' IN ('test', 'live')
    AND p_policy->'cardBrands' IS NOT DISTINCT FROM jsonb_build_array('verve', 'visa', 'mastercard'),
    false
  );
$$;
ALTER FUNCTION private.redvault_attempt_filter_policy_valid(jsonb, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.redvault_attempt_filter_policy_valid(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.capture_or_hold_uba_redvault_payment(uuid, uuid, text, text, jsonb)
  RENAME TO capture_or_hold_uba_redvault_payment_legacy_915;
REVOKE ALL ON FUNCTION public.capture_or_hold_uba_redvault_payment_legacy_915(uuid, uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.capture_or_hold_uba_redvault_payment(
  p_transaction_id uuid, p_order_id uuid, p_gateway text, p_reference text, p_gateway_response jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_transaction_order_id uuid;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden: capture_or_hold_uba_redvault_payment requires service_role'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0));
  SELECT transaction.order_id INTO v_transaction_order_id
  FROM public.transactions AS transaction WHERE transaction.id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR v_transaction_order_id IS DISTINCT FROM p_order_id THEN
    RETURN public.capture_or_hold_uba_redvault_payment_legacy_915(p_transaction_id, p_order_id, p_gateway, p_reference, p_gateway_response);
  END IF;
  PERFORM 1 FROM public.orders WHERE id = p_order_id;
  SELECT attempt.* INTO v_attempt
  FROM private.uba_redvault_payment_attempts AS attempt
  JOIN public.transactions AS transaction ON transaction.order_id = attempt.order_id AND transaction.gateway_reference = attempt.reference
  WHERE attempt.order_id = p_order_id AND transaction.id = p_transaction_id
  FOR UPDATE OF attempt;
  IF NOT FOUND THEN RAISE EXCEPTION 'redvault_capture_attempt_not_found'; END IF;
  IF v_attempt.state = 'approved' THEN
    IF p_gateway IS DISTINCT FROM 'paystack' OR p_reference IS DISTINCT FROM v_attempt.reference
      OR p_gateway_response->>'reference' IS DISTINCT FROM v_attempt.provider_response->>'capture_reference'
      OR p_gateway_response->>'amount' IS DISTINCT FROM v_attempt.provider_response->>'capture_amount_kobo'
      OR upper(p_gateway_response->>'currency') IS DISTINCT FROM v_attempt.provider_response->>'capture_currency'
      OR lower(p_gateway_response->>'status') IS DISTINCT FROM v_attempt.provider_response->>'capture_status' THEN
      RAISE EXCEPTION 'redvault_capture_evidence_conflict';
    END IF;
    RETURN jsonb_build_object('duplicate', true, 'kind', 'captured_held', 'reason', 'provider_eligibility_evidence_unavailable');
  END IF;
  RETURN public.capture_or_hold_uba_redvault_payment_legacy_915(p_transaction_id, p_order_id, p_gateway, p_reference, p_gateway_response);
END;
$$;
ALTER FUNCTION public.capture_or_hold_uba_redvault_payment(uuid, uuid, text, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.capture_or_hold_uba_redvault_payment(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capture_or_hold_uba_redvault_payment(uuid, uuid, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.get_uba_redvault_verification_context(
  p_order_id uuid,
  p_transaction_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_context jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: get_uba_redvault_verified_completion_context requires service_role';
  END IF;
  IF p_transaction_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'redvault_verified_completion_context_invalid_arguments';
  END IF;
  SELECT jsonb_build_object(
    'merchantId', transaction.merchant_id,
    'orderId', order_row.id,
    'transactionId', transaction.id,
    'reference', attempt.reference,
    'amountKobo', attempt.amount_kobo,
    'currency', attempt.currency,
    'customerEmail', application.customer_email,
    'issuerName', attempt.accepted_filter_policy->>'issuerName',
    'verificationDomain', attempt.accepted_filter_policy->>'verificationDomain',
    'acceptedFilterPolicyHash', attempt.accepted_filter_policy_hash
  ) INTO v_context
  FROM public.transactions AS transaction
  JOIN public.orders AS order_row ON order_row.id = transaction.order_id
  JOIN private.uba_redvault_payment_attempts AS attempt
    ON attempt.order_id = order_row.id AND attempt.reference = transaction.gateway_reference
  JOIN private.uba_redvault_applications AS application ON application.id = attempt.application_id
  WHERE transaction.id = p_transaction_id
    AND transaction.order_id = p_order_id
    AND transaction.merchant_id = '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid
    AND transaction.gateway = 'paystack'
    AND order_row.merchant_id = transaction.merchant_id
    AND order_row.payment_method = 'uba_redvault'
    AND attempt.state IN ('captured_held', 'approved')
    AND application.status IN ('pending', 'approved')
    AND private.redvault_attempt_filter_policy_valid(attempt.accepted_filter_policy, attempt.accepted_filter_policy_hash)
  ;
  IF v_context IS NULL THEN RAISE EXCEPTION 'redvault_verification_context_not_found'; END IF;
  RETURN v_context;
END;
$$;
ALTER FUNCTION public.get_uba_redvault_verification_context(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_uba_redvault_verification_context(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_uba_redvault_verification_context(uuid, uuid) TO service_role;
