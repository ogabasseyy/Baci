CREATE FUNCTION private.ensure_redvault_attempt_transaction(p_attempt_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attempt private.uba_redvault_payment_attempts%ROWTYPE;
  v_transaction public.transactions%ROWTYPE;
  v_count integer;
BEGIN
  SELECT * INTO STRICT v_attempt FROM private.uba_redvault_payment_attempts WHERE id = p_attempt_id;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_attempt.reference, 0));
  SELECT count(*) INTO v_count FROM public.transactions WHERE gateway_reference = v_attempt.reference;
  IF v_count > 1 THEN RAISE EXCEPTION 'redvault_attempt_transaction_conflict'; END IF;
  IF v_count = 1 THEN
    SELECT * INTO STRICT v_transaction FROM public.transactions WHERE gateway_reference = v_attempt.reference FOR UPDATE;
    IF v_transaction.order_id IS DISTINCT FROM v_attempt.order_id
      OR v_transaction.merchant_id IS DISTINCT FROM v_attempt.merchant_id
      OR v_transaction.amount * 100 IS DISTINCT FROM v_attempt.amount_kobo::numeric
      OR v_transaction.currency IS DISTINCT FROM v_attempt.currency
      OR v_transaction.gateway IS DISTINCT FROM 'paystack'
      OR v_transaction.transaction_type IS DISTINCT FROM 'payment'
      OR v_transaction.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'redvault_attempt_transaction_conflict';
    END IF;
    RETURN;
  END IF;
  INSERT INTO public.transactions(id, merchant_id, order_id, transaction_type, amount, currency, status, gateway, gateway_reference, platform_fee)
  VALUES (extensions.gen_random_uuid(), v_attempt.merchant_id, v_attempt.order_id, 'payment',
    v_attempt.amount_kobo::numeric / 100, v_attempt.currency, 'pending', 'paystack', v_attempt.reference, NULL);
END;
$$;
ALTER FUNCTION private.ensure_redvault_attempt_transaction(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.ensure_redvault_attempt_transaction(uuid) FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.reserve_storefront_redvault_payment_attempt(uuid) RENAME TO reserve_storefront_redvault_payment_attempt_legacy_926;
REVOKE ALL ON FUNCTION public.reserve_storefront_redvault_payment_attempt_legacy_926(uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.reserve_storefront_redvault_payment_attempt(p_order_id uuid)
RETURNS TABLE (attempt_id uuid, reference text, amount_kobo bigint, currency text, quote_payload_hash text, state text, bank_code text, authorization_url text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_receipt record;
BEGIN
  SELECT * INTO STRICT v_receipt FROM public.reserve_storefront_redvault_payment_attempt_legacy_926(p_order_id);
  PERFORM private.ensure_redvault_attempt_transaction(v_receipt.attempt_id);
  RETURN QUERY SELECT v_receipt.attempt_id, v_receipt.reference, v_receipt.amount_kobo, v_receipt.currency,
    v_receipt.quote_payload_hash, v_receipt.state, v_receipt.bank_code, v_receipt.authorization_url;
END;
$$;
ALTER FUNCTION public.reserve_storefront_redvault_payment_attempt(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reserve_storefront_redvault_payment_attempt(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_storefront_redvault_payment_attempt(uuid) TO authenticated;

ALTER FUNCTION public.claim_storefront_redvault_payment_attempt_initialization(uuid) RENAME TO claim_redvault_initialization_legacy_926;
REVOKE ALL ON FUNCTION public.claim_redvault_initialization_legacy_926(uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.claim_storefront_redvault_payment_attempt_initialization(p_attempt_id uuid)
RETURNS TABLE (attempt_id uuid, reference text, amount_kobo bigint, currency text, quote_payload_hash text, state text, bank_code text, authorization_url text, initialization_claimed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_receipt record;
BEGIN
  SELECT * INTO STRICT v_receipt FROM public.claim_redvault_initialization_legacy_926(p_attempt_id);
  PERFORM private.ensure_redvault_attempt_transaction(v_receipt.attempt_id);
  RETURN QUERY SELECT v_receipt.attempt_id, v_receipt.reference, v_receipt.amount_kobo, v_receipt.currency,
    v_receipt.quote_payload_hash, v_receipt.state, v_receipt.bank_code, v_receipt.authorization_url, v_receipt.initialization_claimed;
END;
$$;
ALTER FUNCTION public.claim_storefront_redvault_payment_attempt_initialization(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization(uuid) TO authenticated;

ALTER FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb) RENAME TO approve_and_complete_uba_redvault_payment_legacy_926;
REVOKE ALL ON FUNCTION public.approve_and_complete_uba_redvault_payment_legacy_926(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.approve_and_complete_uba_redvault_payment(p_transaction_id uuid, p_order_id uuid, p_verified_evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb; v_transaction_status text; v_fees jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: approve_and_complete_uba_redvault_payment requires service_role';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0));
  SELECT status INTO v_transaction_status FROM public.transactions WHERE id = p_transaction_id AND order_id = p_order_id FOR UPDATE;
  IF NOT FOUND OR (v_transaction_status IN ('pending', 'completed')) IS NOT TRUE THEN
    RAISE EXCEPTION 'redvault_verified_completion_transaction_state_invalid';
  END IF;
  SELECT gateway_response->'fees' INTO v_fees FROM public.transactions WHERE id = p_transaction_id;
  v_result := public.approve_and_complete_uba_redvault_payment_legacy_926(p_transaction_id, p_order_id, p_verified_evidence);
  IF v_result->>'kind' IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'redvault_verified_completion_result_invalid'; END IF;
  UPDATE public.transactions SET gateway_response = jsonb_build_object(
    'reference', p_verified_evidence->>'reference',
    'amount', p_verified_evidence->'amountKobo',
    'currency', p_verified_evidence->>'currency',
    'status', 'success',
    'paid_at', p_verified_evidence->>'verifiedAt'
  ) || CASE WHEN v_fees IS NOT NULL THEN jsonb_build_object('fees', v_fees) ELSE '{}'::jsonb END
  WHERE id = p_transaction_id AND order_id = p_order_id;
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_and_complete_uba_redvault_payment(uuid, uuid, jsonb) TO service_role;

ALTER FUNCTION public.capture_or_hold_uba_redvault_payment(uuid, uuid, text, text, jsonb) RENAME TO capture_or_hold_uba_redvault_payment_legacy_926;
REVOKE ALL ON FUNCTION public.capture_or_hold_uba_redvault_payment_legacy_926(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.capture_or_hold_uba_redvault_payment(p_transaction_id uuid, p_order_id uuid, p_gateway text, p_reference text, p_gateway_response jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb; v_existing_fees jsonb;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: capture_or_hold_uba_redvault_payment requires service_role';
  END IF;
  v_result := public.capture_or_hold_uba_redvault_payment_legacy_926(p_transaction_id, p_order_id, p_gateway, p_reference, p_gateway_response);
  IF v_result->>'kind' = 'captured_held' AND p_gateway_response ? 'fees' THEN
    IF jsonb_typeof(p_gateway_response->'fees') IS DISTINCT FROM 'number'
      OR (p_gateway_response->>'fees') !~ '^(0|[1-9][0-9]*)$'
      OR (p_gateway_response->>'fees')::numeric > (p_gateway_response->>'amount')::numeric THEN
      RAISE EXCEPTION 'redvault_capture_fee_invalid';
    END IF;
    SELECT gateway_response->'fees' INTO v_existing_fees FROM public.transactions WHERE id = p_transaction_id AND order_id = p_order_id;
    IF v_existing_fees IS NOT NULL AND v_existing_fees IS DISTINCT FROM p_gateway_response->'fees' THEN
      RAISE EXCEPTION 'redvault_capture_fee_conflict';
    END IF;
    UPDATE public.transactions SET gateway_response = COALESCE(gateway_response, '{}'::jsonb) || jsonb_build_object('fees', p_gateway_response->'fees')
    WHERE id = p_transaction_id AND order_id = p_order_id;
  END IF;
  RETURN v_result;
END;
$$;
ALTER FUNCTION public.capture_or_hold_uba_redvault_payment(uuid, uuid, text, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.capture_or_hold_uba_redvault_payment(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capture_or_hold_uba_redvault_payment(uuid, uuid, text, text, jsonb) TO service_role;
