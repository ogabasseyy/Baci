CREATE OR REPLACE FUNCTION public.get_bank_card_offer_checkout_replay(
  p_merchant_id uuid, p_key text, p_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order record;
BEGIN
  IF auth.uid() IS NULL
    OR auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route'
    OR auth.jwt()->>'storefront_order_merchant_id' IS DISTINCT FROM p_merchant_id::text
    OR COALESCE(p_hash, '') !~ '^[0-9a-f]{64}$'
  THEN RETURN NULL; END IF;

  SELECT o.id, o.order_number, o.tracking_token, o.subtotal, o.shipping_fee, o.discount_amount,
    o.tax_amount, o.total, o.customer_id, o.customer_email, o.customer_name, o.customer_phone,
    o.payment_status, o.shipping_status, o.payment_method, o.shipping_address, o.merchant_id,
    o.tax_basis, o.gift_wrapping_fee, o.created_at, o.checkout_request_hash, true AS idempotency_replayed,
    o.currency AS replay_currency, s.payable_kobo AS replay_payable_kobo
  INTO v_order
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id AND c.merchant_id = o.merchant_id
  JOIN private.bank_card_offer_order_snapshots s ON s.order_id = o.id AND s.merchant_id = o.merchant_id
  WHERE o.merchant_id = p_merchant_id AND o.checkout_idempotency_key = p_key
    AND o.payment_method = 'bank_card_offer' AND c.user_id = auth.uid();

  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_order.checkout_request_hash IS DISTINCT FROM p_hash THEN
    RAISE EXCEPTION 'checkout_idempotency_conflict';
  END IF;
  IF v_order.replay_currency IS DISTINCT FROM 'NGN'
    OR v_order.total * 100 IS DISTINCT FROM v_order.replay_payable_kobo
  THEN
    RAISE EXCEPTION 'bank_card_offer_checkout_mismatch';
  END IF;
  RETURN to_jsonb(v_order) - ARRAY['checkout_request_hash', 'replay_currency', 'replay_payable_kobo'];
END;
$$;

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
  v_key text := nullif(btrim(p_order->>'checkout_idempotency_key'), '');
  v_created_at timestamptz;
BEGIN
  IF auth.uid() IS NULL
    OR auth.jwt()->>'storefront_order_context' IS DISTINCT FROM 'route'
    OR auth.jwt()->>'storefront_order_merchant_id' IS DISTINCT FROM v_merchant::text
    OR p_order->>'user_id' IS DISTINCT FROM auth.uid()::text
    OR v_key IS NULL
    OR COALESCE(p_order->>'checkout_request_hash', '') !~ '^[0-9a-f]{64}$'
    OR p_route_proof->'payload' IS DISTINCT FROM jsonb_build_object('order', p_order, 'quote', p_quote)
    OR p_route_proof->>'payload_hash' IS DISTINCT FROM private.transaction_discount_payload_hash(p_route_proof->'payload')
    OR public.quiz_route_proof_valid(p_route_proof, 'storefront_bank_card_offer_order_create',
      v_merchant::text, auth.uid()) IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'bank_card_offer_checkout_not_authorized';
  END IF;

  -- Match the base writer's lock so a simultaneous retry reads the
  -- saved snapshot instead of entering the generic mutable replay path.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_merchant::text || ':checkout:' || v_key, 0));
  v_replay := public.get_bank_card_offer_checkout_replay(
    v_merchant, v_key, p_order->>'checkout_request_hash'
  );
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  IF EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.merchant_id = v_merchant AND o.checkout_idempotency_key = v_key
  ) THEN RAISE EXCEPTION 'checkout_idempotency_conflict'; END IF;
  IF ((p_quote->>'endsAt')::timestamptz > clock_timestamp()) IS NOT TRUE THEN
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
    p_checkout_idempotency_key => v_key,
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

  SELECT o.created_at INTO STRICT v_created_at FROM public.orders o WHERE o.id = v_result.id;
  RETURN to_jsonb(v_result) || jsonb_build_object('created_at', v_created_at);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR no_data_found THEN
  RAISE EXCEPTION 'bank_card_offer_checkout_mismatch';
END;
$$;

