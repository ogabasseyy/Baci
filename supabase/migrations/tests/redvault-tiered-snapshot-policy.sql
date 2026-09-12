SELECT set_config('request.jwt.claims','{"storefront_redvault_customer_email":"customer@example.test","storefront_order_context":"route","storefront_order_merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74"}',false);

DO $$
DECLARE
  v_historical private.uba_redvault_applications%ROWTYPE;
  v_quote jsonb;
  v_order jsonb;
BEGIN
  SELECT * INTO v_historical FROM private.uba_redvault_applications WHERE checkout_key = 'fixture-key';
  IF v_historical.pricing_policy_version <> 'fixed5_v1'
    OR v_historical.discount_kobo <> 500
    OR (SELECT allocation_kobo FROM private.uba_redvault_line_allocations WHERE application_id = v_historical.id) <> 500 THEN
    RAISE EXCEPTION 'historical_fixed5_snapshot_repriced';
  END IF;

  SELECT quote, jsonb_set(order_input, '{checkout_idempotency_key}', '"pre912-new-draft"') INTO v_quote, v_order FROM public.test_input;
  PERFORM public.test_expect_error(
    format('SELECT public.create_storefront_redvault_order_draft(%L::jsonb, %L::jsonb)', v_order::text, v_quote::text),
    'redvault_group_total_mismatch'
  );
END;
$$;

INSERT INTO public.products(id,merchant_id,brand,name,price,condition,vat_category_code,vat_rate) VALUES
  ('33333333-3333-4333-8333-333333333333','6b5cb8a4-5575-456c-b936-8cdfae30db74','Samsung','Galaxy S24 Ultra',199999.99,'new','S',7.5),
  ('44444444-4444-4444-8444-444444444444','6b5cb8a4-5575-456c-b936-8cdfae30db74','Samsung','Galaxy S24 Ultra',200000,'new','S',7.5),
  ('55555555-5555-4555-8555-555555555555','6b5cb8a4-5575-456c-b936-8cdfae30db74','Infinix','Note 50',100,'new','S',7.5);

CREATE FUNCTION public.test_redvault_tier_quote(
  p_lines jsonb,
  p_groups jsonb,
  p_discount_kobo bigint,
  p_eligible_kobo bigint,
  p_subtotal_kobo bigint
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('discountKobo',p_discount_kobo,'eligibleSubtotalKobo',p_eligible_kobo,
    'productSubtotalKobo',p_subtotal_kobo,'lines',p_lines,'groups',p_groups)
$$;

DO $$
DECLARE
  v_quote jsonb;
  v_order jsonb;
  v_count integer;
BEGIN
  v_quote := public.test_redvault_tier_quote(
    '[{"brand":"Samsung","name":"Galaxy S24 Ultra","condition":"new","discountKobo":2000000,"lineId":1,"productId":"33333333-3333-4333-8333-333333333333","quantity":1,"unitDiscountsKobo":[2000000],"unitPriceKobo":19999999,"variantAttributes":{},"variantId":null,"vatCategoryCode":"S","vatRateBp":750}]',
    '[{"condition":"new","discountKobo":2000000,"key":"below-threshold","lineSubtotalKobo":19999999,"members":[{"allocationKobo":2000000,"lineId":1,"quantity":1}],"productId":"33333333-3333-4333-8333-333333333333","taxInclusive":false,"unitPriceKobo":19999999,"variantAttributes":{},"variantId":null,"vatCategoryCode":"S","vatRateBp":750}]',
    2000000, 19999999, 19999999
  );
  v_order := '{"merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74","customer_email":"customer@example.test","customer_name":"Fixture","discount_amount":20000,"checkout_idempotency_key":"tier-below","items":[{"product_id":"33333333-3333-4333-8333-333333333333","quantity":1,"condition":"new","variant_attributes":{}}]}'::jsonb;
  SELECT count(*) INTO v_count FROM public.create_storefront_redvault_order_draft(v_order, v_quote);
  IF v_count <> 1 THEN RAISE EXCEPTION 'below_threshold_tier_not_created'; END IF;

  v_quote := public.test_redvault_tier_quote(
    '[{"brand":"Samsung","name":"Galaxy S24 Ultra","condition":"new","discountKobo":1000000,"lineId":1,"productId":"44444444-4444-4444-8444-444444444444","quantity":1,"unitDiscountsKobo":[1000000],"unitPriceKobo":20000000,"variantAttributes":{},"variantId":null,"vatCategoryCode":"S","vatRateBp":750}]',
    '[{"condition":"new","discountKobo":1000000,"key":"at-threshold","lineSubtotalKobo":20000000,"members":[{"allocationKobo":1000000,"lineId":1,"quantity":1}],"productId":"44444444-4444-4444-8444-444444444444","taxInclusive":false,"unitPriceKobo":20000000,"variantAttributes":{},"variantId":null,"vatCategoryCode":"S","vatRateBp":750}]',
    1000000, 20000000, 20000000
  );
  v_order := '{"merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74","customer_email":"customer@example.test","customer_name":"Fixture","discount_amount":10000,"checkout_idempotency_key":"tier-at","items":[{"product_id":"44444444-4444-4444-8444-444444444444","quantity":1,"condition":"new","variant_attributes":{}}]}'::jsonb;
  PERFORM public.create_storefront_redvault_order_draft(v_order, v_quote);

  v_quote := public.test_redvault_tier_quote(
    '[{"brand":"Samsung","name":"Galaxy S24","condition":"new","discountKobo":1000,"lineId":1,"productId":"11111111-1111-4111-8111-111111111111","quantity":1,"unitDiscountsKobo":[1000],"unitPriceKobo":10000,"variantAttributes":{},"variantId":null,"vatCategoryCode":"S","vatRateBp":750},{"brand":"Infinix","name":"Note 50","condition":"new","discountKobo":0,"lineId":2,"productId":"55555555-5555-4555-8555-555555555555","quantity":1,"unitDiscountsKobo":[0],"unitPriceKobo":10000,"variantAttributes":{},"variantId":null,"vatCategoryCode":"S","vatRateBp":750}]',
    '[{"condition":"new","discountKobo":1000,"key":"mixed-eligible","lineSubtotalKobo":10000,"members":[{"allocationKobo":1000,"lineId":1,"quantity":1}],"productId":"11111111-1111-4111-8111-111111111111","taxInclusive":false,"unitPriceKobo":10000,"variantAttributes":{},"variantId":null,"vatCategoryCode":"S","vatRateBp":750}]',
    1000, 10000, 20000
  );
  v_order := '{"merchant_id":"6b5cb8a4-5575-456c-b936-8cdfae30db74","customer_email":"customer@example.test","customer_name":"Fixture","discount_amount":10,"checkout_idempotency_key":"tier-mixed","items":[{"product_id":"11111111-1111-4111-8111-111111111111","quantity":1,"condition":"new","variant_attributes":{}},{"product_id":"55555555-5555-4555-8555-555555555555","quantity":1,"condition":"new","variant_attributes":{}}]}'::jsonb;
  UPDATE public.products SET price = 200000 WHERE id = '55555555-5555-4555-8555-555555555555';
  v_quote := jsonb_set(v_quote, ARRAY['lines','1','unitPriceKobo'], '20000000');
  v_quote := jsonb_set(v_quote, ARRAY['productSubtotalKobo'], '20010000');
  v_order := jsonb_set(v_order, ARRAY['shipping_fee'], '200000');
  PERFORM public.create_storefront_redvault_order_draft(v_order, v_quote);

  v_quote := jsonb_set(v_quote, ARRAY['discountKobo'], '500'::jsonb);
  v_quote := jsonb_set(v_quote, ARRAY['lines','0','discountKobo'], '500'::jsonb);
  v_quote := jsonb_set(v_quote, ARRAY['lines','0','unitDiscountsKobo'], '[500]'::jsonb);
  v_quote := jsonb_set(v_quote, ARRAY['groups','0','discountKobo'], '500'::jsonb);
  v_quote := jsonb_set(v_quote, ARRAY['groups','0','members','0','allocationKobo'], '500'::jsonb);
  v_order := jsonb_set(v_order, '{discount_amount}', '5');
  v_order := jsonb_set(v_order, '{checkout_idempotency_key}', '"tier-forged-rate"');
  PERFORM public.test_expect_error(
    format('SELECT public.create_storefront_redvault_order_draft(%L::jsonb, %L::jsonb)', v_order::text, v_quote::text),
    'redvault_group_total_mismatch'
  );
END;
$$;

DO $$
BEGIN
  IF (SELECT discount_kobo FROM private.uba_redvault_applications WHERE checkout_key = 'tier-below') <> 2000000
    OR (SELECT discount_kobo FROM private.uba_redvault_applications WHERE checkout_key = 'tier-at') <> 1000000
    OR (SELECT eligible_subtotal_kobo FROM private.uba_redvault_applications WHERE checkout_key = 'tier-mixed') <> 10000
    OR (SELECT pricing_policy_version FROM private.uba_redvault_applications WHERE checkout_key = 'tier-below') <> 'mou_tiered_v1'
    OR (SELECT count(*) FROM public.orders) <> 5 THEN
    RAISE EXCEPTION 'tiered_snapshot_assertion_failed';
  END IF;
END;
$$;

SELECT 'REDVAULT tiered snapshot policy checks passed' AS result;
