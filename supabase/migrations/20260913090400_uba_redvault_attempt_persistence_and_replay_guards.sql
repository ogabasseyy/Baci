CREATE FUNCTION private.ensure_redvault_attempt_transaction_v2(p_attempt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_transaction public.transactions%ROWTYPE;
  v_count integer;
BEGIN
  SELECT * INTO STRICT v_attempt
  FROM private.uba_redvault_payment_attempts
  WHERE id = p_attempt_id;

  IF v_attempt.currency IS DISTINCT FROM 'NGN'
    OR NULLIF(pg_catalog.btrim(v_attempt.paystack_subaccount_code), '') IS NULL
    OR v_attempt.platform_fee_kobo IS NULL
    OR v_attempt.platform_fee_kobo < 0
    OR v_attempt.platform_fee_kobo > v_attempt.amount_kobo THEN
    RAISE EXCEPTION 'redvault_attempt_transaction_conflict';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_attempt.reference, 0)
  );
  SELECT count(*)::integer INTO v_count
  FROM public.transactions
  WHERE gateway_reference = v_attempt.reference;
  IF v_count > 1 THEN
    RAISE EXCEPTION 'redvault_attempt_transaction_conflict';
  END IF;

  IF v_count = 1 THEN
    SELECT * INTO STRICT v_transaction
    FROM public.transactions
    WHERE gateway_reference = v_attempt.reference
    FOR UPDATE;
    IF v_transaction.order_id IS DISTINCT FROM v_attempt.order_id
      OR v_transaction.merchant_id IS DISTINCT FROM v_attempt.merchant_id
      OR v_transaction.amount * 100 IS DISTINCT FROM v_attempt.amount_kobo::numeric
      OR v_transaction.currency IS DISTINCT FROM v_attempt.currency
      OR v_transaction.gateway IS DISTINCT FROM 'paystack'
      OR v_transaction.transaction_type IS DISTINCT FROM 'payment'
      OR v_transaction.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'redvault_attempt_transaction_conflict';
    END IF;
    IF v_transaction.platform_fee IS NULL THEN
      UPDATE public.transactions
      SET platform_fee = v_attempt.platform_fee_kobo::numeric / 100
      WHERE id = v_transaction.id;
    ELSIF v_transaction.platform_fee < 0
      OR v_transaction.platform_fee > v_attempt.amount_kobo::numeric / 100
      OR pg_catalog.round(v_transaction.platform_fee * 100)::bigint
        IS DISTINCT FROM v_attempt.platform_fee_kobo THEN
      RAISE EXCEPTION 'redvault_attempt_transaction_conflict';
    END IF;
    RETURN;
  END IF;

  INSERT INTO public.transactions(
    id,
    merchant_id,
    order_id,
    transaction_type,
    amount,
    currency,
    status,
    gateway,
    gateway_reference,
    platform_fee
  ) VALUES (
    extensions.gen_random_uuid(),
    v_attempt.merchant_id,
    v_attempt.order_id,
    'payment',
    v_attempt.amount_kobo::numeric / 100,
    v_attempt.currency,
    'pending',
    'paystack',
    v_attempt.reference,
    v_attempt.platform_fee_kobo::numeric / 100
  );
END;
$$;
ALTER FUNCTION private.ensure_redvault_attempt_transaction_v2(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.ensure_redvault_attempt_transaction_v2(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(p_order_id uuid)
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order_currency text;
  v_terminal_state text;
  v_receipt record;
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route' THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;

  SELECT pg_catalog.upper(candidate.currency)
  INTO v_order_currency
  FROM public.orders AS candidate
  WHERE candidate.id = p_order_id
    AND candidate.payment_method = 'uba_redvault'
    AND candidate.payment_status = 'unpaid'
  FOR SHARE;
  IF v_order_currency IS DISTINCT FROM 'NGN' THEN
    RAISE EXCEPTION 'redvault_currency_unsupported';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );
  SELECT candidate.state
  INTO v_terminal_state
  FROM private.uba_redvault_payment_attempts AS candidate
  WHERE candidate.order_id = p_order_id
    AND candidate.state IN ('captured_held', 'capture_evidence_review', 'approved')
  ORDER BY candidate.created_at DESC
  LIMIT 1
  FOR UPDATE;
  IF v_terminal_state IS NOT NULL THEN
    RAISE EXCEPTION 'redvault_capture_reconciliation_required';
  END IF;

  SELECT * INTO STRICT v_receipt
  FROM public.reserve_storefront_redvault_payment_attempt_v2(p_order_id);
  PERFORM private.ensure_redvault_attempt_transaction_v2(v_receipt.attempt_id);

  RETURN QUERY SELECT
    v_receipt.attempt_id,
    v_receipt.reference,
    v_receipt.amount_kobo,
    v_receipt.currency,
    v_receipt.quote_payload_hash,
    v_receipt.state,
    v_receipt.bank_code,
    v_receipt.authorization_url,
    v_receipt.paystack_subaccount_code,
    v_receipt.platform_fee_kobo;
END;
$$;
ALTER FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_storefront_redvault_payment_attempt_v3(uuid)
  TO authenticated;

CREATE FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(
  p_attempt_id uuid
)
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt record;
BEGIN
  SELECT * INTO STRICT v_receipt
  FROM public.claim_storefront_redvault_payment_attempt_initialization_v2(
    p_attempt_id
  );
  PERFORM private.ensure_redvault_attempt_transaction_v2(v_receipt.attempt_id);

  RETURN QUERY SELECT
    v_receipt.attempt_id,
    v_receipt.reference,
    v_receipt.amount_kobo,
    v_receipt.currency,
    v_receipt.quote_payload_hash,
    v_receipt.state,
    v_receipt.bank_code,
    v_receipt.authorization_url,
    v_receipt.initialization_claimed,
    v_receipt.paystack_subaccount_code,
    v_receipt.platform_fee_kobo;
END;
$$;
ALTER FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid)
  TO authenticated;

CREATE FUNCTION public.record_storefront_redvault_payment_attempt_initialization_v2(
  p_attempt_id uuid,
  p_state text,
  p_authorization_url text
)
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt record;
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_receipt
  FROM public.record_storefront_redvault_payment_attempt_initialization(
    p_attempt_id,
    p_state,
    p_authorization_url
  );
  PERFORM private.ensure_redvault_attempt_transaction_v2(p_attempt_id);
  SELECT * INTO STRICT v_attempt
  FROM private.uba_redvault_payment_attempts
  WHERE id = p_attempt_id
  FOR SHARE;
  IF NOT private.redvault_attempt_filter_policy_valid(
    v_attempt.accepted_filter_policy,
    v_attempt.accepted_filter_policy_hash
  ) THEN
    RAISE EXCEPTION 'redvault_attempt_filter_policy_invalid';
  END IF;
  IF NULLIF(pg_catalog.btrim(v_attempt.paystack_subaccount_code), '') IS NULL
    OR v_attempt.platform_fee_kobo IS NULL
    OR v_attempt.platform_fee_kobo < 0
    OR v_attempt.platform_fee_kobo > v_attempt.amount_kobo THEN
    RAISE EXCEPTION 'redvault_paystack_split_missing';
  END IF;

  RETURN QUERY SELECT
    v_attempt.id,
    v_attempt.reference,
    v_attempt.amount_kobo,
    v_attempt.currency,
    v_attempt.quote_payload_hash,
    v_attempt.state,
    v_attempt.accepted_filter_policy->>'bankCode',
    v_attempt.authorization_url,
    v_attempt.paystack_subaccount_code,
    v_attempt.platform_fee_kobo;
END;
$$;
ALTER FUNCTION public.record_storefront_redvault_payment_attempt_initialization_v2(
  uuid, text, text
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.record_storefront_redvault_payment_attempt_initialization_v2(
  uuid, text, text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_storefront_redvault_payment_attempt_initialization_v2(
  uuid, text, text
) TO authenticated;
