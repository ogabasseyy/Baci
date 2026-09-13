ALTER TABLE private.uba_redvault_runtime
  ADD COLUMN IF NOT EXISTS paystack_verification_domain text;

CREATE OR REPLACE FUNCTION private.redvault_attempt_filter_policy_valid(
  p_policy jsonb,
  p_policy_hash text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_typeof(p_policy) = 'object'
    AND p_policy_hash ~ '^[0-9a-f]{64}$'
    AND p_policy_hash = encode(extensions.digest(p_policy::text, 'sha256'), 'hex')
    AND jsonb_typeof(p_policy->'bankCode') = 'string'
    AND p_policy->>'bankCode' ~ '^[0-9]{3}$'
    AND jsonb_typeof(p_policy->'issuerName') = 'string'
    AND NULLIF(p_policy->>'issuerName', '') IS NOT NULL
    AND jsonb_typeof(p_policy->'verificationDomain') = 'string'
    AND p_policy->>'verificationDomain' IN ('test', 'live')
    AND p_policy->'cardBrands' IS NOT DISTINCT FROM jsonb_build_array('verve', 'visa', 'mastercard');
$$;
ALTER FUNCTION private.redvault_attempt_filter_policy_valid(jsonb, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.redvault_attempt_filter_policy_valid(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reserve_storefront_redvault_payment_attempt(p_order_id uuid)
RETURNS TABLE (attempt_id uuid, reference text, amount_kobo bigint, currency text, quote_payload_hash text, state text, bank_code text, authorization_url text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  application private.uba_redvault_applications%ROWTYPE;
  runtime private.uba_redvault_runtime%ROWTYPE;
  attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_filter_policy jsonb;
  v_amount_kobo bigint;
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route' THEN RAISE EXCEPTION 'redvault_route_context_required'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0));
  SELECT * INTO attempt FROM private.uba_redvault_payment_attempts AS candidate
    WHERE candidate.order_id = p_order_id AND candidate.state IN ('created','initializing','initialized','indeterminate')
    ORDER BY candidate.created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO application FROM private.uba_redvault_applications WHERE id = attempt.application_id FOR SHARE;
  ELSE
    SELECT * INTO application FROM private.uba_redvault_applications WHERE order_id = p_order_id FOR UPDATE;
  END IF;
  IF NOT FOUND OR application.status <> 'pending' OR application.merchant_id::text IS DISTINCT FROM auth.jwt()->>'storefront_order_merchant_id'
    OR application.customer_email IS DISTINCT FROM auth.jwt()->>'storefront_redvault_customer_email' OR application.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'redvault_customer_context_required'; END IF;
  IF attempt.id IS NOT NULL THEN
    IF NOT private.redvault_attempt_filter_policy_valid(attempt.accepted_filter_policy, attempt.accepted_filter_policy_hash) THEN
      RAISE EXCEPTION 'redvault_attempt_filter_policy_invalid';
    END IF;
    RETURN QUERY SELECT attempt.id, attempt.reference, attempt.amount_kobo, attempt.currency,
      attempt.quote_payload_hash, attempt.state, attempt.accepted_filter_policy->>'bankCode', attempt.authorization_url;
    RETURN;
  END IF;
  SELECT * INTO runtime FROM private.uba_redvault_runtime WHERE partnership = 'uba_redvault' FOR SHARE;
  IF NOT FOUND OR NOT runtime.enabled THEN RAISE EXCEPTION 'redvault_disabled'; END IF;
  IF runtime.paystack_bank_code IS NULL OR runtime.paystack_bank_code !~ '^[0-9]{3}$'
    OR NULLIF(trim(runtime.paystack_verified_issuer_name), '') IS NULL
    OR runtime.paystack_verification_domain NOT IN ('test', 'live') THEN
    RAISE EXCEPTION 'redvault_bank_filter_unconfigured';
  END IF;
  SELECT round(orders.total * 100)::bigint INTO v_amount_kobo
  FROM public.orders WHERE id = application.order_id AND payment_method = 'uba_redvault' AND payment_status = 'unpaid';
  IF v_amount_kobo IS NULL OR v_amount_kobo <= 0 THEN RAISE EXCEPTION 'redvault_order_snapshot_mismatch'; END IF;
  v_filter_policy := jsonb_build_object(
    'bankCode', runtime.paystack_bank_code,
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'),
    'issuerName', trim(runtime.paystack_verified_issuer_name),
    'verificationDomain', runtime.paystack_verification_domain
  );
  INSERT INTO private.uba_redvault_payment_attempts(
    application_id, order_id, merchant_id, reference, quote_payload_hash,
    amount_kobo, currency, state, accepted_filter_policy, accepted_filter_policy_hash
  ) VALUES (
    application.id, application.order_id, application.merchant_id,
    'RV-' || replace(extensions.gen_random_uuid()::text, '-', ''), application.quote_payload_hash,
    v_amount_kobo, 'NGN', 'created', v_filter_policy,
    encode(extensions.digest(v_filter_policy::text, 'sha256'), 'hex')
  ) RETURNING * INTO attempt;
  RETURN QUERY SELECT attempt.id, attempt.reference, attempt.amount_kobo, attempt.currency,
    attempt.quote_payload_hash, attempt.state, attempt.accepted_filter_policy->>'bankCode', attempt.authorization_url;
END;
$$;
ALTER FUNCTION public.reserve_storefront_redvault_payment_attempt(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_storefront_redvault_payment_attempt(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_storefront_redvault_payment_attempt(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_storefront_redvault_payment_attempt_initialization(p_attempt_id uuid)
RETURNS TABLE (attempt_id uuid, reference text, amount_kobo bigint, currency text, quote_payload_hash text, state text, bank_code text, authorization_url text, initialization_claimed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE application private.uba_redvault_applications%ROWTYPE; attempt private.uba_redvault_payment_attempts%ROWTYPE; attempt_order_id uuid;
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route' THEN RAISE EXCEPTION 'redvault_route_context_required'; END IF;
  SELECT order_id INTO attempt_order_id FROM private.uba_redvault_payment_attempts WHERE id = p_attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'redvault_attempt_not_found'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('baci_order_payment:' || attempt_order_id::text, 0));
  SELECT * INTO attempt FROM private.uba_redvault_payment_attempts WHERE id = p_attempt_id FOR UPDATE;
  SELECT * INTO application FROM private.uba_redvault_applications WHERE id = attempt.application_id FOR SHARE;
  IF NOT FOUND OR application.status <> 'pending' OR application.merchant_id::text IS DISTINCT FROM auth.jwt()->>'storefront_order_merchant_id'
    OR application.customer_email IS DISTINCT FROM auth.jwt()->>'storefront_redvault_customer_email' OR application.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'redvault_customer_context_required'; END IF;
  IF NOT private.redvault_attempt_filter_policy_valid(attempt.accepted_filter_policy, attempt.accepted_filter_policy_hash) THEN RAISE EXCEPTION 'redvault_attempt_filter_policy_invalid'; END IF;
  IF attempt.state = 'created' THEN
    UPDATE private.uba_redvault_payment_attempts SET state = 'initializing' WHERE id = attempt.id RETURNING * INTO attempt;
    RETURN QUERY SELECT attempt.id,attempt.reference,attempt.amount_kobo,attempt.currency,attempt.quote_payload_hash,attempt.state,attempt.accepted_filter_policy->>'bankCode',attempt.authorization_url,true;
    RETURN;
  END IF;
  RETURN QUERY SELECT attempt.id,attempt.reference,attempt.amount_kobo,attempt.currency,attempt.quote_payload_hash,attempt.state,attempt.accepted_filter_policy->>'bankCode',attempt.authorization_url,false;
END;
$$;
ALTER FUNCTION public.claim_storefront_redvault_payment_attempt_initialization(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_and_complete_uba_redvault_payment(
  p_transaction_id uuid,
  p_order_id uuid,
  p_verified_evidence jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_application private.uba_redvault_applications%ROWTYPE;
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_transaction public.transactions%ROWTYPE;
  v_completion jsonb;
  v_evidence jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'forbidden: approve_and_complete_uba_redvault_payment requires service_role'; END IF;
  IF p_transaction_id IS NULL OR p_order_id IS NULL OR jsonb_typeof(p_verified_evidence) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'redvault_verified_completion_invalid_arguments'; END IF;
  IF NOT (p_verified_evidence ?& ARRAY['acceptedFilterPolicyHash','amountKobo','cardBrand','cardChannel','contractVersion','currency','customerEmail','domain','issuerName','providerVerificationId','reference','verificationSource','verifiedAt'])
    OR (SELECT count(*) FROM jsonb_object_keys(p_verified_evidence)) <> 13
    OR jsonb_typeof(p_verified_evidence->'acceptedFilterPolicyHash') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'amountKobo') IS DISTINCT FROM 'number'
    OR jsonb_typeof(p_verified_evidence->'cardBrand') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'cardChannel') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'contractVersion') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'currency') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'customerEmail') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'domain') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'issuerName') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'providerVerificationId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'reference') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'verificationSource') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p_verified_evidence->'verifiedAt') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'redvault_verified_evidence_invalid';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0));
  SELECT * INTO v_transaction FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND OR v_transaction.order_id IS DISTINCT FROM p_order_id OR v_transaction.merchant_id IS DISTINCT FROM '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid OR v_transaction.gateway IS DISTINCT FROM 'paystack' THEN RAISE EXCEPTION 'redvault_verified_completion_transaction_mismatch'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.payment_method IS DISTINCT FROM 'uba_redvault' OR v_order.merchant_id IS DISTINCT FROM v_transaction.merchant_id THEN RAISE EXCEPTION 'redvault_verified_completion_order_mismatch'; END IF;
  IF v_transaction.status NOT IN ('pending', 'completed') THEN RAISE EXCEPTION 'redvault_verified_completion_transaction_state_invalid'; END IF;
  IF v_order.payment_status IN ('cancelled', 'refunded') OR v_order.shipping_status = 'cancelled' OR v_order.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'redvault_verified_completion_order_state_invalid'; END IF;
  SELECT * INTO v_attempt FROM private.uba_redvault_payment_attempts WHERE order_id = p_order_id AND reference = v_transaction.gateway_reference FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'redvault_verified_completion_attempt_not_found'; END IF;
  SELECT * INTO v_application FROM private.uba_redvault_applications WHERE id = v_attempt.application_id FOR UPDATE;
  IF NOT FOUND OR v_application.order_id IS DISTINCT FROM p_order_id OR v_application.merchant_id IS DISTINCT FROM v_order.merchant_id OR v_application.customer_email IS DISTINCT FROM lower(trim(v_order.customer_email)) OR v_application.quote_payload_hash IS DISTINCT FROM v_attempt.quote_payload_hash THEN RAISE EXCEPTION 'redvault_verified_completion_application_mismatch'; END IF;
  IF NOT private.redvault_attempt_filter_policy_valid(v_attempt.accepted_filter_policy, v_attempt.accepted_filter_policy_hash) THEN RAISE EXCEPTION 'redvault_verified_completion_policy_missing'; END IF;
  IF p_verified_evidence->>'contractVersion' IS DISTINCT FROM 'paystack_verified_card_v1'
    OR p_verified_evidence->>'verificationSource' IS DISTINCT FROM 'paystack_transaction_verify'
    OR p_verified_evidence->>'reference' IS DISTINCT FROM v_attempt.reference
    OR p_verified_evidence->>'acceptedFilterPolicyHash' IS DISTINCT FROM v_attempt.accepted_filter_policy_hash
    OR p_verified_evidence->>'currency' IS DISTINCT FROM v_attempt.currency
    OR p_verified_evidence->>'cardChannel' IS DISTINCT FROM 'card'
    OR p_verified_evidence->>'cardBrand' NOT IN ('verve', 'visa', 'mastercard')
    OR p_verified_evidence->>'issuerName' IS DISTINCT FROM v_attempt.accepted_filter_policy->>'issuerName'
    OR p_verified_evidence->>'domain' IS DISTINCT FROM v_attempt.accepted_filter_policy->>'verificationDomain'
    OR lower(trim(p_verified_evidence->>'customerEmail')) IS DISTINCT FROM v_application.customer_email
    OR NULLIF(p_verified_evidence->>'providerVerificationId', '') IS NULL OR length(p_verified_evidence->>'providerVerificationId') > 200
    OR (p_verified_evidence->>'amountKobo') !~ '^[1-9][0-9]*$'
    OR (p_verified_evidence->>'amountKobo')::bigint IS DISTINCT FROM v_attempt.amount_kobo
    OR (p_verified_evidence->>'verifiedAt')::timestamptz IS NULL THEN RAISE EXCEPTION 'redvault_verified_evidence_invalid'; END IF;
  IF v_transaction.gateway_reference IS DISTINCT FROM v_attempt.reference OR round(v_transaction.amount * 100)::bigint IS DISTINCT FROM v_attempt.amount_kobo OR upper(v_transaction.currency) IS DISTINCT FROM v_attempt.currency OR round(v_order.total * 100)::bigint IS DISTINCT FROM v_attempt.amount_kobo OR v_attempt.provider_response->>'capture_reference' IS DISTINCT FROM v_attempt.reference OR (v_attempt.provider_response->>'capture_amount_kobo')::bigint IS DISTINCT FROM v_attempt.amount_kobo OR v_attempt.provider_response->>'capture_currency' IS DISTINCT FROM v_attempt.currency OR v_attempt.provider_response->>'capture_status' IS DISTINCT FROM 'success' THEN RAISE EXCEPTION 'redvault_verified_completion_capture_mismatch'; END IF;
  v_evidence := p_verified_evidence;
  IF v_attempt.state = 'approved' THEN
    IF v_attempt.provider_response->'verified_evidence' IS DISTINCT FROM v_evidence OR v_application.status IS DISTINCT FROM 'approved' OR v_order.payment_status IS DISTINCT FROM 'paid' OR v_attempt.provider_response->'completion_receipt' IS NULL OR NOT EXISTS (SELECT 1 FROM private.uba_redvault_redemptions WHERE attempt_id = v_attempt.id) THEN RAISE EXCEPTION 'redvault_verified_completion_replay_conflict'; END IF;
    RETURN jsonb_build_object('duplicate', true, 'kind', 'approved', 'completion', v_attempt.provider_response->'completion_receipt');
  END IF;
  IF v_attempt.state IS DISTINCT FROM 'captured_held' OR v_order.payment_status IS DISTINCT FROM 'unpaid' OR v_application.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'redvault_verified_completion_not_held'; END IF;
  IF EXISTS (SELECT 1 FROM private.uba_redvault_refunds WHERE attempt_id = v_attempt.id AND state IN ('pending','processing','processed')) THEN RAISE EXCEPTION 'redvault_verified_completion_refund_pending'; END IF;
  UPDATE private.uba_redvault_payment_attempts SET state = 'approved', provider_response = provider_response || jsonb_build_object('verified_evidence', v_evidence) WHERE id = v_attempt.id;
  UPDATE private.uba_redvault_applications SET status = 'approved' WHERE id = v_application.id;
  INSERT INTO private.uba_redvault_redemptions(application_id,attempt_id,discount_code_id,order_id,merchant_id,customer_email,amount_kobo,provider_verification_id,accepted_filter_policy_hash)
    VALUES (v_application.id,v_attempt.id,v_application.discount_code_id,v_order.id,v_order.merchant_id,v_application.customer_email,v_application.discount_kobo,p_verified_evidence->>'providerVerificationId',v_attempt.accepted_filter_policy_hash);
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current()) ON CONFLICT DO NOTHING;
  v_completion := public.complete_order_gateway_payment(
    p_transaction_id,
    p_order_id,
    jsonb_build_object('paid_at', p_verified_evidence->>'verifiedAt'),
    'uba_redvault_verified_completion'
  );
  IF v_completion ? 'error_code'
    OR COALESCE((v_completion->>'order_updated')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'redvault_verified_completion_standard_completion_rejected';
  END IF;
  UPDATE private.uba_redvault_payment_attempts
  SET provider_response = provider_response || jsonb_build_object('completion_receipt', v_completion)
  WHERE id = v_attempt.id;
  DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current();
  RETURN jsonb_build_object('duplicate', false, 'kind', 'approved', 'completion', v_completion);
END;
$$;
ALTER FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb) TO service_role;
