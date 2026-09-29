BEGIN;

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.uba_redvault_runtime AS runtime
    WHERE runtime.partnership = 'uba_redvault'
      AND runtime.enabled IS TRUE AND runtime.commercial_terms_confirmed IS TRUE
      AND jsonb_typeof(runtime.commercial_terms) = 'object'
      AND runtime.commercial_terms ?& ARRAY[
        'campaign_dates', 'minimum_spend', 'caps', 'usage_limits', 'stacking',
        'split_payments', 'funding_fees', 'refund_usage_restoration', 'operations_owner'
      ]
      AND runtime.paystack_bank_code IS NOT NULL
      AND runtime.paystack_verified_issuer_name IS NOT NULL
      AND runtime.paystack_verification_domain IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'local_redvault_runtime_or_filter_prerequisite_missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM private.uba_redvault_discount_binding AS binding
    JOIN public.discount_codes AS code ON code.id = binding.discount_code_id
    WHERE binding.merchant_id = '6b5cb8a4-5575-456c-b936-8cdfae30db74'
      AND binding.partnership = 'uba_redvault'
      AND code.discount_type = 'percentage' AND code.discount_value = 5
      AND code.is_active IS TRUE AND code.applies_to = 'all'
      AND COALESCE(code.minimum_purchase_amount, 0) = 0
      AND code.maximum_discount_amount >= 5
  ) THEN
    RAISE EXCEPTION 'local_fixed_five_redvault_binding_prerequisite_missing';
  END IF;
END;
$$;

SELECT private.configure_uba_redvault_live_pilot(
  true, (SELECT product_id FROM redvault_private_pilot_case), pg_catalog.now() + interval '1 hour'
);

SELECT pg_catalog.set_config('request.jwt.claims', jsonb_build_object(
  'sub', '70261bce-d358-45a4-9ede-8b9d71fb3bd9',
  'role', 'authenticated',
  'storefront_redvault_customer_email', 'redvault-pilot-full-schema@example.test',
  'storefront_order_context', 'route',
  'storefront_order_merchant_id', '6b5cb8a4-5575-456c-b936-8cdfae30db74'
)::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  created record;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  SELECT * INTO STRICT created
  FROM public.create_storefront_redvault_order(
    fixture.order_input, fixture.quote,
    public.redvault_private_pilot_test_route_proof(fixture.order_input, fixture.quote)
  );
  IF created.status IS DISTINCT FROM 'pending' OR created.idempotency_replayed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'protected_create_unexpected_result';
  END IF;
  UPDATE redvault_private_pilot_case SET order_id = created.id;
END;
$$;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  other_user_order jsonb;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  PERFORM pg_catalog.set_config('request.jwt.claims', jsonb_build_object(
    'sub', '15151515-1515-4515-8515-151515151515',
    'role', 'authenticated',
    'storefront_redvault_customer_email', 'redvault-pilot-full-schema@example.test',
    'storefront_order_context', 'route',
    'storefront_order_merchant_id', '6b5cb8a4-5575-456c-b936-8cdfae30db74'
  )::text, true);
  other_user_order := jsonb_set(
    jsonb_set(fixture.order_input, '{user_id}', '"15151515-1515-4515-8515-151515151515"'),
    '{checkout_idempotency_key}', '"redvault-private-pilot-full-schema-other-user"'
  );
  BEGIN
    PERFORM * FROM public.create_storefront_redvault_order(
      other_user_order, fixture.quote,
      public.redvault_private_pilot_test_route_proof(other_user_order, fixture.quote)
    );
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_order_binding_mismatch' THEN
    RAISE EXCEPTION 'enabled_pilot_other_user_order_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
  PERFORM pg_catalog.set_config('request.jwt.claims', jsonb_build_object(
    'sub', '70261bce-d358-45a4-9ede-8b9d71fb3bd9',
    'role', 'authenticated',
    'storefront_redvault_customer_email', 'redvault-pilot-full-schema@example.test',
    'storefront_order_context', 'route',
    'storefront_order_merchant_id', '6b5cb8a4-5575-456c-b936-8cdfae30db74'
  )::text, true);
END;
$$;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  reserved record;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  SELECT * INTO STRICT reserved
  FROM public.reserve_storefront_redvault_payment_attempt_v3(fixture.order_id);
  IF reserved.amount_kobo IS DISTINCT FROM 9500
    OR reserved.currency IS DISTINCT FROM 'NGN'
    OR reserved.attempt_id IS NULL THEN
    RAISE EXCEPTION 'protected_reserve_unexpected_result';
  END IF;
  UPDATE redvault_private_pilot_case SET attempt_id = reserved.attempt_id;
END;
$$;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  claimed record;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  SELECT * INTO STRICT claimed
  FROM public.claim_storefront_redvault_payment_attempt_initialization_v3(fixture.attempt_id);
  IF claimed.initialization_claimed IS DISTINCT FROM true
    OR claimed.split_retained_shipping_kobo IS DISTINCT FROM 0
    OR claimed.amount_kobo IS DISTINCT FROM 9500 THEN
    RAISE EXCEPTION 'protected_claim_unexpected_result';
  END IF;
END;
$$;

RESET ROLE;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  BEGIN
    INSERT INTO public.shipments(
      order_id, merchant_id, provider, status, sender_address, receiver_address, items
    ) VALUES (
      fixture.order_id, '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'GIGL', 'pending',
      '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_physical_fulfillment_blocked' THEN
    RAISE EXCEPTION 'active_pilot_shipment_insert_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
END;
$$;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  replay_count integer;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  SELECT count(*) INTO replay_count
  FROM private.redvault_discount_proof_replay AS proof
  JOIN private.uba_redvault_applications AS application ON application.proof_id = proof.proof_id
  WHERE application.order_id = fixture.order_id
    AND proof.order_id = fixture.order_id
    AND proof.quote_version_id = application.quote_version_id;
  IF replay_count <> 1 THEN RAISE EXCEPTION 'protected_create_did_not_attach_proof'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM private.uba_redvault_live_pilot_policy AS policy
    WHERE policy.enabled IS TRUE AND policy.reserved_order_id = fixture.order_id
      AND policy.reserved_attempt_id = fixture.attempt_id
  ) THEN RAISE EXCEPTION 'protected_reservation_binding_missing'; END IF;
END;
$$;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  second_order jsonb;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  second_order := jsonb_set(fixture.order_input, '{checkout_idempotency_key}', '"redvault-private-pilot-full-schema-two"');
  PERFORM pg_catalog.set_config('request.jwt.claims', jsonb_build_object(
    'sub', '70261bce-d358-45a4-9ede-8b9d71fb3bd9',
    'role', 'authenticated',
    'storefront_redvault_customer_email', 'redvault-pilot-full-schema@example.test',
    'storefront_order_context', 'route',
    'storefront_order_merchant_id', '6b5cb8a4-5575-456c-b936-8cdfae30db74'
  )::text, true);
  BEGIN
    PERFORM * FROM public.create_storefront_redvault_order(
      second_order, fixture.quote, public.redvault_private_pilot_test_route_proof(second_order, fixture.quote)
    );
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_attempt_cap_reached' THEN
    RAISE EXCEPTION 'second_order_after_cap_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
END;
$$;

RESET ROLE;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  IF EXISTS (SELECT 1 FROM public.orders WHERE checkout_idempotency_key = 'redvault-private-pilot-full-schema-two')
    OR EXISTS (SELECT 1 FROM private.uba_redvault_applications WHERE checkout_key = 'redvault-private-pilot-full-schema-two')
    OR EXISTS (SELECT 1 FROM public.orders WHERE checkout_idempotency_key = 'redvault-private-pilot-full-schema-other-user')
    OR EXISTS (SELECT 1 FROM private.uba_redvault_applications WHERE checkout_key = 'redvault-private-pilot-full-schema-other-user') THEN
    RAISE EXCEPTION 'second_order_cap_rejection_left_draft_rows';
  END IF;
  UPDATE private.uba_redvault_live_pilot_policy
  SET expires_at = pg_catalog.now() - interval '1 second' WHERE singleton;
  PERFORM private.configure_uba_redvault_live_pilot(false, NULL, NULL);
END;
$$;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  ordinary_order jsonb;
  ordinary_quote jsonb;
  created record;
  reserved record;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  ordinary_order := jsonb_set(
    jsonb_set(
      jsonb_set(fixture.order_input, '{items,0,product_id}', to_jsonb(fixture.ordinary_product_id::text)),
      '{user_id}', '"15151515-1515-4515-8515-151515151515"'
    ),
    '{checkout_idempotency_key}', '"redvault-private-pilot-full-schema-nonpilot"'
  );
  ordinary_quote := jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(fixture.quote, '{lines,0,productId}', to_jsonb(fixture.ordinary_product_id::text)),
          '{lines,0,brand}', '"REDVAULT fixture"'
        ),
        '{lines,0,name}', '"REDVAULT non-pilot rollback product"'
      ),
      '{groups,0,productId}', to_jsonb(fixture.ordinary_product_id::text)
    ),
    '{groups,0,key}', '"redvault-nonpilot-fixture"'
  );
  PERFORM pg_catalog.set_config('request.jwt.claims', jsonb_build_object(
    'sub', '15151515-1515-4515-8515-151515151515',
    'role', 'authenticated',
    'storefront_redvault_customer_email', 'redvault-pilot-full-schema@example.test',
    'storefront_order_context', 'route',
    'storefront_order_merchant_id', '6b5cb8a4-5575-456c-b936-8cdfae30db74'
  )::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO STRICT created
  FROM public.create_storefront_redvault_order(
    ordinary_order, ordinary_quote,
    public.redvault_private_pilot_test_route_proof(ordinary_order, ordinary_quote)
  );
  SELECT * INTO STRICT reserved
  FROM public.reserve_storefront_redvault_payment_attempt_v3(created.id);
  IF reserved.attempt_id IS NULL OR reserved.amount_kobo IS DISTINCT FROM 9500 THEN
    RAISE EXCEPTION 'disabled_pilot_nonpilot_reservation_unexpected';
  END IF;
  RESET ROLE;
END;
$$;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  shipment_id uuid;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  ALTER TABLE public.shipments DISABLE TRIGGER guard_uba_redvault_pilot_shipment_write;
  INSERT INTO public.shipments(
    order_id, merchant_id, provider, status, sender_address, receiver_address, items
  ) VALUES (
    fixture.order_id, '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'TOPSHIP', 'pending',
    '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
  ) RETURNING id INTO shipment_id;
  ALTER TABLE public.shipments ENABLE TRIGGER guard_uba_redvault_pilot_shipment_write;
  BEGIN
    UPDATE public.shipments SET status = 'booked' WHERE id = shipment_id;
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_physical_fulfillment_blocked' THEN
    RAISE EXCEPTION 'disabled_pilot_shipment_update_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
  caught := NULL;
  BEGIN
    INSERT INTO public.shipments(
      order_id, merchant_id, provider, status, sender_address, receiver_address, items
    ) VALUES (
      fixture.order_id, '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'GIGL', 'pending',
      '{}'::jsonb, '{}'::jsonb, '[]'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_physical_fulfillment_blocked' THEN
    RAISE EXCEPTION 'disabled_pilot_shipment_insert_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
END;
$$;

SELECT pg_catalog.set_config('request.jwt.claims', jsonb_build_object(
  'sub', '70261bce-d358-45a4-9ede-8b9d71fb3bd9',
  'role', 'authenticated',
  'storefront_redvault_customer_email', 'redvault-pilot-full-schema@example.test',
  'storefront_order_context', 'route',
  'storefront_order_merchant_id', '6b5cb8a4-5575-456c-b936-8cdfae30db74'
)::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  BEGIN
    PERFORM * FROM public.reserve_storefront_redvault_payment_attempt_v3(fixture.order_id);
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_disabled_or_expired' THEN
    RAISE EXCEPTION 'expired_reserve_replay_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
  caught := NULL;
  BEGIN
    PERFORM * FROM public.claim_storefront_redvault_payment_attempt_initialization_v3(fixture.attempt_id);
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_disabled_or_expired' THEN
    RAISE EXCEPTION 'expired_initialization_claim_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
END;
$$;

RESET ROLE;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  IF EXISTS (SELECT 1 FROM public.orders WHERE id = fixture.order_id AND payment_status <> 'unpaid') THEN
    RAISE EXCEPTION 'test_changed_payment_state';
  END IF;
  IF EXISTS (SELECT 1 FROM private.uba_redvault_payment_attempts WHERE id = fixture.attempt_id
    AND (authorization_url IS NOT NULL OR state IN ('approved', 'captured_held'))) THEN
    RAISE EXCEPTION 'test_performed_or_simulated_provider_completion';
  END IF;
END;
$$;

SELECT 'Full-schema REDVAULT pilot, legacy RPC revocation, non-pilot compatibility, shipment insert/update, cap, and expiry checks passed; no provider request was made' AS result;
ROLLBACK;
