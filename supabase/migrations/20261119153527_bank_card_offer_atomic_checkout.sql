-- Store the offer in the same transaction as the ordinary storefront order.
-- Only the merchant-scoped storefront route may supply the priced quote.
CREATE FUNCTION public.create_storefront_bank_card_offer_order(
  p_order jsonb, p_quote jsonb, p_route_proof jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_merchant uuid := (p_order->>'merchant_id')::uuid;
  v_result record;
  v_allocations jsonb;
  v_quote jsonb;
  v_merchandise_kobo numeric;
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
    p_expected_total => NULL,
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
    OR v_result.total * 100 < 100
  THEN
    RAISE EXCEPTION 'bank_card_offer_checkout_mismatch';
  END IF;
  v_quote := jsonb_set(p_quote, '{allocations}', v_allocations);
  PERFORM private.record_bank_card_offer_order(v_result.id, v_merchant, v_quote);

  RETURN to_jsonb(v_result);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR no_data_found THEN
  RAISE EXCEPTION 'bank_card_offer_checkout_mismatch';
END;
$$;

REVOKE ALL ON FUNCTION public.create_storefront_bank_card_offer_order(jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_storefront_bank_card_offer_order(jsonb, jsonb, jsonb)
  TO authenticated;
