INSERT INTO public.products(
  id, merchant_id, name, price, condition, vat_category_code, vat_rate
) VALUES (
  '92900000-0000-4000-8000-000000000001',
  '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  'REDVAULT variant condition fixture',
  100,
  'new',
  'S',
  7.5
);

INSERT INTO public.product_variants(
  id, product_id, price_override, condition, merchant_id
) VALUES (
  '92900000-0000-4000-8000-000000000002',
  '92900000-0000-4000-8000-000000000001',
  120,
  'used',
  '6b5cb8a4-5575-456c-b936-8cdfae30db74'
);

SET ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
  'role', 'authenticated',
  'storefront_order_context', 'route',
  'storefront_order_merchant_id', '6b5cb8a4-5575-456c-b936-8cdfae30db74'
)::text, false);
DO $$
DECLARE selected_condition text;
BEGIN
  SELECT condition INTO selected_condition
  FROM public.get_storefront_redvault_variant_pricing(
    ARRAY['92900000-0000-4000-8000-000000000002'::uuid]
  );
  IF selected_condition IS DISTINCT FROM 'used' THEN
    RAISE EXCEPTION 'REDVAULT 929 selected variant condition was not returned';
  END IF;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'private'
      AND table_name = 'uba_redvault_payment_attempts'
      AND column_name = 'paystack_subaccount_code'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'private'
      AND table_name = 'uba_redvault_payment_attempts'
      AND column_name = 'platform_fee_kobo'
  ) THEN
    RAISE EXCEPTION 'REDVAULT 929 split snapshot columns are missing';
  END IF;
  IF has_function_privilege('anon', 'public.get_storefront_redvault_variant_pricing(uuid[])', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.get_storefront_redvault_variant_pricing(uuid[])', 'EXECUTE')
    OR has_function_privilege('anon', 'public.reserve_storefront_redvault_payment_attempt_v2(uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.reserve_storefront_redvault_payment_attempt_v2(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.claim_storefront_redvault_payment_attempt_initialization_v2(uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.claim_storefront_redvault_payment_attempt_initialization_v2(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'REDVAULT 929 grants are broader than customer checkout';
  END IF;
END;
$$;

SELECT 'REDVAULT 929 variant condition and Paystack split contract passed' AS result;
