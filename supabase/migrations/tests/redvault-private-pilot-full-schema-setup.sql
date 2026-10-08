-- redvault-private-pilot-full-schema-setup.sql
-- Part 1/5: opens the single test transaction, seeds fixtures (temp case table, users, dedicated products, route-proof helper), and asserts the legacy grant/prerequisite baseline.
--
-- Runs concatenated with the other parts in filename order inside one
-- psql session/transaction (see run-redvault-private-pilot-full-schema.sh);
-- do not run standalone. The runner opens the transaction; part 5 rolls
-- it back.

-- (BEGIN provided by the runner.)

SET LOCAL app.quiz_rpc_server_secret_current = 'local-fixture-only';

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(role_name, 'private.configure_uba_redvault_live_pilot(boolean,uuid,timestamptz)', 'EXECUTE')
      OR has_table_privilege(role_name, 'private.uba_redvault_live_pilot_policy', 'SELECT') THEN
      RAISE EXCEPTION 'private_pilot_policy_grant_leaked:%', role_name;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'public.reserve_storefront_redvault_payment_attempt_v3(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.reserve_storefront_redvault_payment_attempt_v3(uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.reserve_storefront_redvault_payment_attempt_v3(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.claim_storefront_redvault_payment_attempt_initialization_v3(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.create_storefront_redvault_order(jsonb,jsonb,jsonb)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.create_storefront_redvault_order(jsonb,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'private_pilot_protected_rpc_grants_invalid';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.reserve_storefront_redvault_payment_attempt(uuid)'),
      ('public.reserve_storefront_redvault_payment_attempt_v2(uuid)'),
      ('public.claim_storefront_redvault_payment_attempt_initialization(uuid)'),
      ('public.claim_storefront_redvault_payment_attempt_initialization_v2(uuid)')
    ) AS legacy(signature)
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS role_set(role_name)
    WHERE has_function_privilege(role_set.role_name, legacy.signature, 'EXECUTE')
  ) OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.reserve_storefront_redvault_payment_attempt(uuid)'::regprocedure),
      ('public.reserve_storefront_redvault_payment_attempt_v2(uuid)'::regprocedure),
      ('public.claim_storefront_redvault_payment_attempt_initialization(uuid)'::regprocedure),
      ('public.claim_storefront_redvault_payment_attempt_initialization_v2(uuid)'::regprocedure)
    ) AS legacy(function_id)
    JOIN pg_proc AS procedure ON procedure.oid = legacy.function_id
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(
      procedure.proacl, pg_catalog.acldefault('f', procedure.proowner)
    )) AS grant_entry
    WHERE grant_entry.grantee = 0 AND grant_entry.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'private_pilot_legacy_rpc_grant_leaked';
  END IF;
END;
$$;

INSERT INTO auth.users(id)
SELECT '70261bce-d358-45a4-9ede-8b9d71fb3bd9'::uuid
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '70261bce-d358-45a4-9ede-8b9d71fb3bd9')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users(id)
SELECT '15151515-1515-4515-8515-151515151515'::uuid
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE id = '15151515-1515-4515-8515-151515151515')
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE redvault_private_pilot_case (
  product_id uuid PRIMARY KEY,
  ordinary_product_id uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  order_input jsonb NOT NULL,
  quote jsonb NOT NULL,
  order_id uuid,
  attempt_id uuid
) ON COMMIT DROP;

INSERT INTO redvault_private_pilot_case(product_id, order_input, quote)
SELECT product_id, jsonb_build_object(
    'merchant_id', '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    'customer_email', 'redvault-pilot-full-schema@example.test',
    'customer_name', 'REDVAULT rollback fixture',
    'user_id', '70261bce-d358-45a4-9ede-8b9d71fb3bd9',
    'discount_amount', 5,
    'tax_amount', 0,
    'shipping_fee', 0,
    'gift_wrapping_fee', 0,
    'expected_total', 95,
    'currency', 'NGN',
    'checkout_idempotency_key', 'redvault-private-pilot-full-schema-one',
    'checkout_request_hash', repeat('a', 64),
    'items', jsonb_build_array(jsonb_build_object(
      'product_id', product_id, 'quantity', 1, 'condition', 'new', 'variant_attributes', '{}'::jsonb,
      '__baci_line_ordinal', 1
    ))
  ), jsonb_build_object(
    'discountKobo', 500,
    'eligibleSubtotalKobo', 10000,
    'productSubtotalKobo', 10000,
    'lines', jsonb_build_array(jsonb_build_object(
      'brand', 'REDVAULT fixture', 'name', 'REDVAULT rollback-only product', 'condition', 'new',
      'discountKobo', 500, 'lineId', 1, 'productId', product_id, 'quantity', 1,
      'unitDiscountsKobo', jsonb_build_array(500), 'unitPriceKobo', 10000,
      'variantAttributes', '{}'::jsonb, 'variantId', NULL,
      'vatCategoryCode', 'S', 'vatRateBp', 0
    )),
    'groups', jsonb_build_array(jsonb_build_object(
      'condition', 'new', 'discountKobo', 500, 'key', 'redvault-fixture',
      'lineSubtotalKobo', 10000,
      'members', jsonb_build_array(jsonb_build_object('allocationKobo', 500, 'lineId', 1, 'quantity', 1)),
      'productId', product_id, 'taxInclusive', false, 'unitPriceKobo', 10000,
      'variantAttributes', '{}'::jsonb, 'variantId', NULL,
      'vatCategoryCode', 'S', 'vatRateBp', 0
    ))
  )
FROM (SELECT extensions.gen_random_uuid() AS product_id) AS fixture;
GRANT SELECT, UPDATE ON redvault_private_pilot_case TO authenticated;

INSERT INTO public.products(
  id, merchant_id, brand, name, price, condition, vat_category_code, vat_rate,
  has_variants, taxable, manage_stock, stock_quantity, stock, status
)
SELECT product_id, '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'REDVAULT fixture',
  'REDVAULT rollback-only product', 100, 'new', 'S', 0, false, false, false, 1, 1, 'active'
FROM redvault_private_pilot_case;

INSERT INTO public.products(
  id, merchant_id, brand, name, price, condition, vat_category_code, vat_rate,
  has_variants, taxable, manage_stock, stock_quantity, stock, status
)
SELECT ordinary_product_id, '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'REDVAULT fixture',
  'REDVAULT non-pilot rollback product', 100, 'new', 'S', 0, false, false, false, 1, 1, 'active'
FROM redvault_private_pilot_case;

CREATE FUNCTION public.redvault_private_pilot_probe_product(product_name text, tracking_policy text DEFAULT 'off')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  product_id uuid;
BEGIN
  INSERT INTO public.products(
    id, merchant_id, brand, name, price, condition, vat_category_code, vat_rate,
    has_variants, taxable, manage_stock, stock_quantity, stock, status,
    inventory_tracking_policy
  )
  VALUES (
    extensions.gen_random_uuid(), '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'REDVAULT fixture',
    product_name, 100, 'new', 'S', 0, false, false, false, 1, 1, 'active',
    tracking_policy
  )
  RETURNING id INTO product_id;
  RETURN product_id;
END;
$$;

CREATE FUNCTION public.redvault_private_pilot_test_route_proof(p_order jsonb, p_quote jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  issued text := pg_catalog.now()::text;
  user_id text := COALESCE(auth.uid()::text, 'guest');
  payload jsonb := jsonb_build_object('order', p_order, 'quote', p_quote);
  payload_hash text;
  signature text;
BEGIN
  payload_hash := private.transaction_discount_payload_hash(payload);
  signature := pg_catalog.encode(extensions.hmac(
    'quiz-rpc-proof:v1' || E'\nquiz_phase1a\nstorefront_redvault_order_create\n'
      || (p_order->>'merchant_id') || E'\n' || user_id || E'\n' || issued || E'\n' || payload_hash,
    'local-fixture-only', 'sha256'), 'hex');
  RETURN jsonb_build_object(
    'version', 'quiz-rpc-proof:v1', 'scope', 'quiz_phase1a',
    'action', 'storefront_redvault_order_create', 'subject_id', p_order->>'merchant_id',
    'user_id', user_id, 'issued_at', issued, 'payload', payload,
    'payload_hash', payload_hash, 'signature', signature, 'proof_id', left(signature, 24)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.redvault_private_pilot_test_route_proof(jsonb, jsonb) TO authenticated;

