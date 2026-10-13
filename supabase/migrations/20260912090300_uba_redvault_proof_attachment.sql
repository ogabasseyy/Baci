CREATE OR REPLACE FUNCTION public.attach_storefront_redvault_discount_proof(
  p_order_id uuid, p_quote_version_id uuid, p_quote_payload_hash text, p_proof jsonb
) RETURNS TABLE (status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_application private.uba_redvault_applications%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_payload jsonb := p_proof->'payload';
  v_expected jsonb;
  v_hash text;
  v_proof_id text := p_proof->>'proof_id';
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route' THEN RAISE EXCEPTION 'redvault_route_context_required'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR auth.jwt()->>'storefront_order_merchant_id' IS DISTINCT FROM v_order.merchant_id::text THEN RAISE EXCEPTION 'redvault_route_context_required'; END IF;
  SELECT * INTO v_application FROM private.uba_redvault_applications
    WHERE order_id = p_order_id AND quote_version_id = p_quote_version_id FOR UPDATE;
  IF NOT FOUND OR v_application.quote_payload_hash IS DISTINCT FROM p_quote_payload_hash THEN RAISE EXCEPTION 'redvault_quote_not_found'; END IF;
  IF v_application.merchant_id IS DISTINCT FROM v_order.merchant_id
    OR auth.jwt()->>'storefront_redvault_customer_email' IS DISTINCT FROM v_application.customer_email
    OR v_application.user_id IS DISTINCT FROM auth.uid()
    OR v_application.customer_email IS DISTINCT FROM lower(trim(v_order.customer_email))
    OR p_proof->>'user_id' IS DISTINCT FROM COALESCE(v_application.user_id::text, 'guest') THEN
    RAISE EXCEPTION 'redvault_customer_context_required';
  END IF;
  v_expected := (v_application.proof_context - 'applicationId') || jsonb_build_object(
    'version', 1, 'partnership', 'uba_redvault', 'merchantId', v_application.merchant_id,
    'customerEmail', v_application.customer_email, 'orderId', p_order_id,
    'quoteVersionId', p_quote_version_id, 'quotePayloadHash', p_quote_payload_hash);
  v_hash := private.transaction_discount_payload_hash(v_payload);
  IF jsonb_typeof(v_payload) IS DISTINCT FROM 'object'
    OR (v_payload - 'nonce') IS DISTINCT FROM v_expected
    OR COALESCE(v_payload->>'nonce','') !~ '^[0-9a-f-]{36}$'
    OR p_proof->>'action' IS DISTINCT FROM 'storefront_redvault_discount'
    OR p_proof->>'subject_id' IS DISTINCT FROM v_application.merchant_id::text
    OR v_hash IS DISTINCT FROM p_proof->>'payload_hash'
    OR NULLIF(v_proof_id, '') IS NULL
    OR v_proof_id IS DISTINCT FROM left(p_proof->>'signature',24)
    OR public.quiz_route_proof_valid(p_proof, 'storefront_redvault_discount', v_application.merchant_id::text, auth.uid()) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'redvault_proof_rejected';
  END IF;
  IF v_order.payment_method IS DISTINCT FROM 'uba_redvault' OR v_order.payment_status IS DISTINCT FROM 'unpaid'
    OR v_order.discount_amount * 100 IS DISTINCT FROM v_application.discount_kobo::numeric THEN RAISE EXCEPTION 'redvault_order_snapshot_mismatch'; END IF;
  IF v_application.status <> 'draft' THEN
    IF v_application.status <> 'pending' THEN RAISE EXCEPTION 'order_not_reusable'; END IF;
    RETURN QUERY SELECT v_application.status;
    RETURN;
  END IF;
  INSERT INTO private.redvault_discount_proof_replay(proof_id, payload_hash, order_id, quote_version_id, merchant_id)
    VALUES (v_proof_id, v_hash, p_order_id, p_quote_version_id, v_application.merchant_id)
    ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'redvault_proof_replayed'; END IF;
  UPDATE private.uba_redvault_applications SET proof_id = v_proof_id, status = 'pending' WHERE id = v_application.id;
  RETURN QUERY SELECT 'pending'::text;
END;
$$;
ALTER FUNCTION public.attach_storefront_redvault_discount_proof(uuid, uuid, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.attach_storefront_redvault_discount_proof(uuid, uuid, text, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.attach_storefront_redvault_discount_proof(uuid, uuid, text, jsonb) TO authenticated;
