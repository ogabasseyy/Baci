CREATE FUNCTION public.create_storefront_redvault_order(
  p_order jsonb, p_quote jsonb, p_route_proof jsonb
) RETURNS TABLE (id uuid, quote_version_id uuid, quote_payload_hash text, proof_context jsonb, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_draft record;
  v_payload jsonb;
  v_proof jsonb;
  v_secret text;
  v_issued text := pg_catalog.now()::text;
  v_hash text;
  v_signature text;
  v_status text;
  v_merchant text := p_order->>'merchant_id';
  v_user text := COALESCE(auth.uid()::text, 'guest');
  v_fulfillment jsonb := p_order->'merchant_fulfillment';
  v_rate_id uuid;
BEGIN
  IF auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route'
    OR auth.jwt()->>'storefront_order_merchant_id' IS DISTINCT FROM v_merchant THEN
    RAISE EXCEPTION 'redvault_route_context_required';
  END IF;
  IF p_route_proof->'payload' IS DISTINCT FROM jsonb_build_object('order', p_order, 'quote', p_quote)
    OR p_route_proof->>'payload_hash' IS DISTINCT FROM private.transaction_discount_payload_hash(p_route_proof->'payload')
    OR p_route_proof->>'user_id' IS DISTINCT FROM v_user
    OR p_route_proof->>'proof_id' IS DISTINCT FROM left(p_route_proof->>'signature', 24)
    OR public.quiz_route_proof_valid(p_route_proof, 'storefront_redvault_order_create', v_merchant, auth.uid()) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'redvault_proof_rejected';
  END IF;

  SELECT * INTO STRICT v_draft FROM public.create_storefront_redvault_order_draft(p_order, p_quote);
  SELECT application.status INTO STRICT v_status FROM private.uba_redvault_applications AS application
    WHERE application.order_id = v_draft.id FOR UPDATE;
  IF v_status = 'pending' THEN
    RETURN QUERY SELECT v_draft.id, v_draft.quote_version_id, v_draft.quote_payload_hash, v_draft.proof_context, v_status;
    RETURN;
  END IF;

  IF v_fulfillment IS NOT NULL THEN
    IF jsonb_typeof(v_fulfillment) IS DISTINCT FROM 'object'
      OR (v_fulfillment->>'provider' IN ('MERCHANT', 'MERCHANT_PICKUP')) IS NOT TRUE
      OR NULLIF(trim(v_fulfillment->>'rate_name'), '') IS NULL
      OR NULLIF(v_fulfillment->>'rate_id', '') IS NULL THEN
      RAISE EXCEPTION 'redvault_fulfillment_invalid';
    END IF;
    SELECT rate.id INTO v_rate_id FROM public.merchant_shipping_rates AS rate
      WHERE rate.id = (v_fulfillment->>'rate_id')::uuid AND rate.merchant_id = v_merchant::uuid FOR KEY SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'redvault_fulfillment_rate_not_found'; END IF;
    INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current()) ON CONFLICT DO NOTHING;
    UPDATE public.orders SET
      shipping_provider = v_fulfillment->>'provider',
      shipping_rate_id = v_rate_id,
      shipping_rate_name = v_fulfillment->>'rate_name',
      shipping_pickup_details = CASE WHEN v_fulfillment->>'provider' = 'MERCHANT_PICKUP'
        THEN NULLIF(v_fulfillment->'pickup_details', 'null'::jsonb) ELSE NULL END
      WHERE orders.id = v_draft.id AND orders.merchant_id = v_merchant::uuid;
    DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current();
  END IF;

  v_secret := NULLIF(current_setting('app.quiz_rpc_server_secret_current', true), '');
  IF v_secret IS NULL THEN
    SELECT secret INTO v_secret FROM private.quiz_rpc_server_secrets
      WHERE secret_name = 'current' AND (expires_at IS NULL OR expires_at > pg_catalog.now());
  END IF;
  IF NULLIF(v_secret, '') IS NULL THEN RAISE EXCEPTION 'redvault_proof_signing_unavailable'; END IF;
  v_payload := (v_draft.proof_context - 'applicationId') || jsonb_build_object(
    'version', 1, 'partnership', 'uba_redvault', 'merchantId', v_merchant,
    'customerEmail', lower(trim(p_order->>'customer_email')), 'orderId', v_draft.id,
    'quoteVersionId', v_draft.quote_version_id, 'quotePayloadHash', v_draft.quote_payload_hash,
    'nonce', extensions.gen_random_uuid());
  v_hash := private.transaction_discount_payload_hash(v_payload);
  v_signature := pg_catalog.encode(extensions.hmac(
    'quiz-rpc-proof:v1' || E'\nquiz_phase1a\nstorefront_redvault_discount\n' || v_merchant || E'\n' || v_user || E'\n' || v_issued || E'\n' || v_hash,
    v_secret, 'sha256'), 'hex');
  v_proof := jsonb_build_object('version', 'quiz-rpc-proof:v1', 'scope', 'quiz_phase1a',
    'action', 'storefront_redvault_discount', 'subject_id', v_merchant, 'user_id', v_user,
    'issued_at', v_issued, 'payload', v_payload, 'payload_hash', v_hash,
    'signature', v_signature, 'proof_id', left(v_signature, 24));
  SELECT attached.status INTO STRICT v_status FROM public.attach_storefront_redvault_discount_proof(
    v_draft.id, v_draft.quote_version_id, v_draft.quote_payload_hash, v_proof) AS attached;
  IF v_status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'redvault_attachment_not_pending'; END IF;
  RETURN QUERY SELECT v_draft.id, v_draft.quote_version_id, v_draft.quote_payload_hash, v_draft.proof_context, v_status;
END;
$$;
ALTER FUNCTION public.create_storefront_redvault_order(jsonb, jsonb, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_storefront_redvault_order(jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_storefront_redvault_order(jsonb, jsonb, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.create_storefront_redvault_order_draft(jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
