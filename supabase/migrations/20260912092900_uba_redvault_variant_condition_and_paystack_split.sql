ALTER TABLE private.uba_redvault_payment_attempts
  ADD COLUMN IF NOT EXISTS paystack_subaccount_code text,
  ADD COLUMN IF NOT EXISTS platform_fee_kobo bigint;

ALTER TABLE private.uba_redvault_payment_attempts
  ADD CONSTRAINT uba_redvault_payment_attempts_paystack_split_check
  CHECK (
    (paystack_subaccount_code IS NULL AND platform_fee_kobo IS NULL)
    OR (
      NULLIF(trim(paystack_subaccount_code), '') IS NOT NULL
      AND platform_fee_kobo >= 0
      AND platform_fee_kobo <= amount_kobo
    )
  ) NOT VALID;

CREATE FUNCTION public.get_storefront_redvault_variant_pricing(p_variant_ids uuid[])
RETURNS TABLE (
  id uuid,
  product_id uuid,
  price_override numeric,
  condition text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    variant.id,
    variant.product_id,
    variant.price_override,
    variant.condition
  FROM public.product_variants AS variant
  WHERE COALESCE(array_length(p_variant_ids, 1), 0) <= 10000
    AND variant.id = ANY(COALESCE(p_variant_ids, ARRAY[]::uuid[]));
$$;
ALTER FUNCTION public.get_storefront_redvault_variant_pricing(uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_storefront_redvault_variant_pricing(uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_storefront_redvault_variant_pricing(uuid[]) TO authenticated;

CREATE FUNCTION public.reserve_storefront_redvault_payment_attempt_v2(p_order_id uuid)
RETURNS TABLE (
  attempt_id uuid,
  reference text,
  amount_kobo bigint,
  currency text,
  quote_payload_hash text,
  state text,
  bank_code text,
  authorization_url text,
  paystack_subaccount_code text,
  platform_fee_kobo bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  application private.uba_redvault_applications%ROWTYPE;
  runtime private.uba_redvault_runtime%ROWTYPE;
  attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_filter_policy jsonb;
  v_amount_kobo bigint;
  v_paystack_subaccount_code text;
  v_platform_fee_kobo bigint;
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route' THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );
  SELECT * INTO attempt
  FROM private.uba_redvault_payment_attempts AS candidate
  WHERE candidate.order_id = p_order_id
    AND candidate.state IN ('created', 'initializing', 'initialized', 'indeterminate')
  ORDER BY candidate.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    SELECT * INTO application
    FROM private.uba_redvault_applications
    WHERE id = attempt.application_id
    FOR SHARE;
  ELSE
    SELECT * INTO application
    FROM private.uba_redvault_applications
    WHERE order_id = p_order_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND
    OR application.status <> 'pending'
    OR application.merchant_id::text IS DISTINCT FROM auth.jwt()->>'storefront_order_merchant_id'
    OR application.customer_email IS DISTINCT FROM auth.jwt()->>'storefront_redvault_customer_email'
    OR application.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'redvault_customer_context_required';
  END IF;

  IF attempt.id IS NOT NULL THEN
    IF NOT private.redvault_attempt_filter_policy_valid(
      attempt.accepted_filter_policy,
      attempt.accepted_filter_policy_hash
    ) THEN
      RAISE EXCEPTION 'redvault_attempt_filter_policy_invalid';
    END IF;
    IF NULLIF(trim(attempt.paystack_subaccount_code), '') IS NULL
      OR attempt.platform_fee_kobo IS NULL
      OR attempt.platform_fee_kobo < 0
      OR attempt.platform_fee_kobo > attempt.amount_kobo THEN
      RAISE EXCEPTION 'redvault_paystack_split_missing';
    END IF;
    RETURN QUERY SELECT
      attempt.id,
      attempt.reference,
      attempt.amount_kobo,
      attempt.currency,
      attempt.quote_payload_hash,
      attempt.state,
      attempt.accepted_filter_policy->>'bankCode',
      attempt.authorization_url,
      attempt.paystack_subaccount_code,
      attempt.platform_fee_kobo;
    RETURN;
  END IF;

  SELECT * INTO runtime
  FROM private.uba_redvault_runtime
  WHERE partnership = 'uba_redvault'
  FOR SHARE;
  IF NOT FOUND OR NOT runtime.enabled THEN
    RAISE EXCEPTION 'redvault_disabled';
  END IF;
  IF runtime.paystack_bank_code IS NULL
    OR runtime.paystack_bank_code !~ '^[0-9]{3}$'
    OR NULLIF(trim(runtime.paystack_verified_issuer_name), '') IS NULL
    OR runtime.paystack_verification_domain NOT IN ('test', 'live') THEN
    RAISE EXCEPTION 'redvault_bank_filter_unconfigured';
  END IF;

  SELECT round(orders.total * 100)::bigint INTO v_amount_kobo
  FROM public.orders
  WHERE id = application.order_id
    AND payment_method = 'uba_redvault'
    AND payment_status = 'unpaid';
  IF v_amount_kobo IS NULL OR v_amount_kobo <= 0 THEN
    RAISE EXCEPTION 'redvault_order_snapshot_mismatch';
  END IF;

  SELECT NULLIF(trim(merchant.paystack_subaccount_code), '')
  INTO v_paystack_subaccount_code
  FROM public.merchants AS merchant
  WHERE merchant.id = application.merchant_id
  FOR SHARE;
  IF v_paystack_subaccount_code IS NULL THEN
    RAISE EXCEPTION 'redvault_paystack_split_unconfigured';
  END IF;
  v_platform_fee_kobo := LEAST(
    round(v_amount_kobo::numeric * 2 / 100)::bigint,
    205000::bigint
  );

  v_filter_policy := jsonb_build_object(
    'bankCode', runtime.paystack_bank_code,
    'cardBrands', jsonb_build_array('verve', 'visa', 'mastercard'),
    'issuerName', trim(runtime.paystack_verified_issuer_name),
    'verificationDomain', runtime.paystack_verification_domain
  );
  INSERT INTO private.uba_redvault_payment_attempts(
    application_id,
    order_id,
    merchant_id,
    reference,
    quote_payload_hash,
    amount_kobo,
    currency,
    state,
    accepted_filter_policy,
    accepted_filter_policy_hash,
    paystack_subaccount_code,
    platform_fee_kobo
  ) VALUES (
    application.id,
    application.order_id,
    application.merchant_id,
    'RV-' || replace(extensions.gen_random_uuid()::text, '-', ''),
    application.quote_payload_hash,
    v_amount_kobo,
    'NGN',
    'created',
    v_filter_policy,
    encode(extensions.digest(v_filter_policy::text, 'sha256'), 'hex'),
    v_paystack_subaccount_code,
    v_platform_fee_kobo
  ) RETURNING * INTO attempt;

  RETURN QUERY SELECT
    attempt.id,
    attempt.reference,
    attempt.amount_kobo,
    attempt.currency,
    attempt.quote_payload_hash,
    attempt.state,
    attempt.accepted_filter_policy->>'bankCode',
    attempt.authorization_url,
    attempt.paystack_subaccount_code,
    attempt.platform_fee_kobo;
END;
$$;
ALTER FUNCTION public.reserve_storefront_redvault_payment_attempt_v2(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_storefront_redvault_payment_attempt_v2(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_storefront_redvault_payment_attempt_v2(uuid) TO authenticated;

CREATE FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v2(p_attempt_id uuid)
RETURNS TABLE (
  attempt_id uuid,
  reference text,
  amount_kobo bigint,
  currency text,
  quote_payload_hash text,
  state text,
  bank_code text,
  authorization_url text,
  initialization_claimed boolean,
  paystack_subaccount_code text,
  platform_fee_kobo bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  application private.uba_redvault_applications%ROWTYPE;
  attempt private.uba_redvault_payment_attempts%ROWTYPE;
  attempt_order_id uuid;
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route' THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;
  SELECT order_id INTO attempt_order_id
  FROM private.uba_redvault_payment_attempts
  WHERE id = p_attempt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'redvault_attempt_not_found';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || attempt_order_id::text, 0)
  );
  SELECT * INTO attempt
  FROM private.uba_redvault_payment_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;
  SELECT * INTO application
  FROM private.uba_redvault_applications
  WHERE id = attempt.application_id
  FOR SHARE;
  IF NOT FOUND
    OR application.status <> 'pending'
    OR application.merchant_id::text IS DISTINCT FROM auth.jwt()->>'storefront_order_merchant_id'
    OR application.customer_email IS DISTINCT FROM auth.jwt()->>'storefront_redvault_customer_email'
    OR application.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'redvault_customer_context_required';
  END IF;
  IF NOT private.redvault_attempt_filter_policy_valid(
    attempt.accepted_filter_policy,
    attempt.accepted_filter_policy_hash
  ) THEN
    RAISE EXCEPTION 'redvault_attempt_filter_policy_invalid';
  END IF;
  IF NULLIF(trim(attempt.paystack_subaccount_code), '') IS NULL
    OR attempt.platform_fee_kobo IS NULL
    OR attempt.platform_fee_kobo < 0
    OR attempt.platform_fee_kobo > attempt.amount_kobo THEN
    RAISE EXCEPTION 'redvault_paystack_split_missing';
  END IF;

  IF attempt.state = 'created' THEN
    UPDATE private.uba_redvault_payment_attempts
    SET state = 'initializing'
    WHERE id = attempt.id
    RETURNING * INTO attempt;
    RETURN QUERY SELECT
      attempt.id,
      attempt.reference,
      attempt.amount_kobo,
      attempt.currency,
      attempt.quote_payload_hash,
      attempt.state,
      attempt.accepted_filter_policy->>'bankCode',
      attempt.authorization_url,
      true,
      attempt.paystack_subaccount_code,
      attempt.platform_fee_kobo;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    attempt.id,
    attempt.reference,
    attempt.amount_kobo,
    attempt.currency,
    attempt.quote_payload_hash,
    attempt.state,
    attempt.accepted_filter_policy->>'bankCode',
    attempt.authorization_url,
    false,
    attempt.paystack_subaccount_code,
    attempt.platform_fee_kobo;
END;
$$;
ALTER FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v2(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v2(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v2(uuid) TO authenticated;
