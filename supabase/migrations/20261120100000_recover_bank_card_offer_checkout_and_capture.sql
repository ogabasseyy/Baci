CREATE OR REPLACE FUNCTION public.create_storefront_bank_card_offer_order(
  p_order jsonb, p_quote jsonb, p_route_proof jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_merchant uuid := (p_order->>'merchant_id')::uuid;
  v_result record;
  v_allocations jsonb;
  v_quote jsonb;
  v_merchandise_kobo numeric;
  v_fulfillment jsonb := p_order->'merchant_fulfillment';
  v_rate_id uuid;
  v_replay jsonb;
BEGIN
  IF auth.uid() IS NULL
    OR auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route'
    OR auth.jwt()->>'storefront_order_merchant_id' IS DISTINCT FROM v_merchant::text
    OR p_order->>'user_id' IS DISTINCT FROM auth.uid()::text
    OR COALESCE(p_order->>'checkout_idempotency_key', '') = ''
    OR COALESCE(p_order->>'checkout_request_hash', '') !~ '^[0-9a-f]{64}$'
    OR p_route_proof->'payload' IS DISTINCT FROM jsonb_build_object('order', p_order, 'quote', p_quote)
    OR p_route_proof->>'payload_hash' IS DISTINCT FROM private.transaction_discount_payload_hash(p_route_proof->'payload')
    OR public.quiz_route_proof_valid(p_route_proof, 'storefront_bank_card_offer_order_create',
      v_merchant::text, auth.uid()) IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'bank_card_offer_checkout_not_authorized';
  END IF;

  IF ((p_quote->>'endsAt')::timestamptz > clock_timestamp()) IS NOT TRUE THEN
    v_replay := public.get_bank_card_offer_checkout_replay(
      v_merchant, p_order->>'checkout_idempotency_key', p_order->>'checkout_request_hash'
    );
    IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
    RAISE EXCEPTION 'bank_card_offer_checkout_expired';
  END IF;

  SELECT * INTO STRICT v_result FROM public.create_storefront_order(
    p_merchant_id => v_merchant,
    p_customer_email => p_order->>'customer_email',
    p_customer_name => p_order->>'customer_name',
    p_items => p_order->'items',
    p_customer_phone => p_order->>'customer_phone',
    p_shipping_fee => (p_order->>'shipping_fee')::numeric,
    p_discount_amount => (p_quote->>'discountKobo')::numeric / 100,
    p_tax_amount => (p_order->>'tax_amount')::numeric,
    p_payment_method => 'bank_card_offer',
    p_payment_status => 'unpaid',
    p_shipping_status => 'pending',
    p_shipping_address => NULLIF(p_order->'shipping_address', 'null'::jsonb),
    p_source => p_order->>'source',
    p_notes => p_order->>'notes',
    p_ad_tracking => NULLIF(p_order->'ad_tracking', 'null'::jsonb),
    p_selected_quote_id => (p_order->>'selected_quote_id')::uuid,
    p_shipping_provider => p_order->>'shipping_provider',
    p_tracking_number => p_order->>'tracking_number',
    p_user_id => auth.uid(),
    p_tax_basis => 'exclusive',
    p_gift_wrapping_fee => (p_order->>'gift_wrapping_fee')::numeric,
    p_expected_total => (p_order->>'expected_total')::numeric,
    p_checkout_idempotency_key => p_order->>'checkout_idempotency_key',
    p_checkout_request_hash => p_order->>'checkout_request_hash'
  );

  -- Persist real order-item UUIDs. A missing ordinal leaves a gap which the
  -- snapshot writer's line-count and amount checks reject atomically.
  SELECT jsonb_agg(jsonb_set(quoted.value, '{itemId}', to_jsonb(item.id)) ORDER BY quoted.ordinality),
         sum(item.price * item.quantity * 100)
    INTO v_allocations, v_merchandise_kobo
    FROM jsonb_array_elements(p_quote->'allocations') WITH ORDINALITY AS quoted(value, ordinality)
    JOIN public.order_items AS item ON item.order_id = v_result.id
     AND item.line_id = quoted.ordinality;
  IF jsonb_array_length(v_allocations) IS DISTINCT FROM jsonb_array_length(p_quote->'allocations')
    OR v_merchandise_kobo IS DISTINCT FROM (p_quote->>'productSubtotalKobo')::numeric
    OR ((p_order->>'expected_total') IS NOT NULL
      AND v_result.total IS DISTINCT FROM (p_order->>'expected_total')::numeric)
    OR v_result.total * 100 < 100
  THEN
    RAISE EXCEPTION 'bank_card_offer_checkout_mismatch';
  END IF;
  v_quote := jsonb_set(p_quote, '{allocations}', v_allocations);
  PERFORM private.record_bank_card_offer_order(v_result.id, v_merchant, v_quote);

  IF v_fulfillment IS NOT NULL AND NOT v_result.idempotency_replayed THEN
    IF (v_fulfillment->>'provider' IN ('MERCHANT', 'MERCHANT_PICKUP')) IS NOT TRUE
      OR NULLIF(btrim(v_fulfillment->>'rate_name'), '') IS NULL
    THEN RAISE EXCEPTION 'bank_card_offer_checkout_mismatch'; END IF;
    SELECT rate.id INTO STRICT v_rate_id FROM public.merchant_shipping_rates rate
      WHERE rate.id = (v_fulfillment->>'rate_id')::uuid AND rate.merchant_id = v_merchant
      FOR KEY SHARE;
    UPDATE public.orders SET
      shipping_provider = v_fulfillment->>'provider',
      shipping_rate_id = v_rate_id,
      shipping_rate_name = v_fulfillment->>'rate_name',
      shipping_pickup_details = CASE WHEN v_fulfillment->>'provider' = 'MERCHANT_PICKUP'
        THEN NULLIF(v_fulfillment->'pickup_details', 'null'::jsonb) END
      WHERE id = v_result.id AND merchant_id = v_merchant;
  END IF;

  RETURN to_jsonb(v_result);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR no_data_found THEN
  RAISE EXCEPTION 'bank_card_offer_checkout_mismatch';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_bank_card_offer_verification_context(
  p_order_id uuid, p_merchant_id uuid, p_transaction_id uuid
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('quote', ctx.quote, 'amountKobo', ctx.amount_kobo,
    'customerEmail', ctx.customer_email, 'reference', ctx.reference,
    'acceptedFilterPolicyHash', a.policy_hash, 'domain', a.provider_domain,
    'completedGatewayResponse', CASE WHEN t.status IN ('pending', 'processing', 'completed')
      AND jsonb_typeof(t.gateway_response) = 'object'
      AND t.gateway_response->>'reference' = ctx.reference
      AND t.gateway_response->>'status' = 'success'
      AND t.gateway_response->'amount' = to_jsonb(ctx.amount_kobo)
      AND t.gateway_response->>'domain' = a.provider_domain
      AND t.gateway_response->>'id' = a.verified_evidence->>'providerVerificationId'
      AND a.verified_evidence->>'reference' = ctx.reference
      AND a.verified_evidence->>'acceptedFilterPolicyHash' = a.policy_hash
      AND a.verified_evidence->>'domain' = a.provider_domain
      AND a.verified_evidence->'amountKobo' = to_jsonb(ctx.amount_kobo)
      THEN t.gateway_response ELSE NULL END)
  FROM private.bank_card_offer_payment_attempts a
  JOIN public.transactions t ON t.id = a.transaction_id
  CROSS JOIN LATERAL private.read_bank_card_offer_payment_context(p_order_id, p_merchant_id, p_transaction_id) ctx
  WHERE a.order_id = p_order_id AND a.transaction_id = p_transaction_id
    AND auth.uid() IS NULL
    AND auth.jwt()->>'storefront_order_context' = 'route'
    AND auth.jwt()->>'storefront_order_merchant_id' = p_merchant_id::text;
$$;

-- Save the response and approval together so completion can retry during a
-- provider outage. The four-argument writer remains an internal validator.
CREATE FUNCTION public.approve_bank_card_offer_capture(
  p_order_id uuid, p_merchant_id uuid, p_transaction_id uuid,
  p_evidence jsonb, p_gateway_response jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.get_bank_card_offer_verification_context(p_order_id, p_merchant_id, p_transaction_id) IS NULL
    OR jsonb_typeof(p_gateway_response) IS DISTINCT FROM 'object'
    OR p_gateway_response->>'status' IS DISTINCT FROM 'success'
    OR p_gateway_response->>'reference' IS DISTINCT FROM p_evidence->>'reference'
    OR p_gateway_response->>'domain' IS DISTINCT FROM p_evidence->>'domain'
    OR upper(p_gateway_response->>'currency') IS DISTINCT FROM p_evidence->>'currency'
    OR p_gateway_response->>'id' IS DISTINCT FROM p_evidence->>'providerVerificationId'
    OR p_gateway_response->'amount' IS DISTINCT FROM p_evidence->'amountKobo'
  THEN RETURN false; END IF;

  PERFORM 1 FROM public.transactions
    WHERE id = p_transaction_id AND order_id = p_order_id AND merchant_id = p_merchant_id
      AND status IN ('pending', 'processing', 'completed')
    FOR UPDATE;
  IF NOT FOUND OR public.approve_bank_card_offer_capture(
    p_order_id, p_merchant_id, p_transaction_id, p_evidence
  ) IS DISTINCT FROM true THEN RETURN false; END IF;

  UPDATE public.transactions
    SET gateway_response = p_gateway_response
    WHERE id = p_transaction_id AND (status <> 'completed' OR gateway_response IS NULL);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.approve_bank_card_offer_capture(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.approve_bank_card_offer_capture(uuid, uuid, uuid, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_bank_card_offer_capture(uuid, uuid, uuid, jsonb, jsonb)
  TO authenticated;
