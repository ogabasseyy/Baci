-- redvault-private-pilot-full-schema-staging.sql
-- Part 2/5: disabled-policy behavior — unflagged staging fails closed at binding, then the flagged staging database lets the pilot account create and reserve an ordinary order through the normal path.
--
-- Runs concatenated with the other parts in filename order inside one
-- psql session/transaction (see run-redvault-private-pilot-full-schema.sh);
-- do not run standalone.

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

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  blocked_order jsonb;
  blocked_quote jsonb;
  caught text;
BEGIN
  -- Disabled, never-bound policy WITHOUT the staging flag (unconfigured
  -- production shape): the pilot account's order must fail closed at
  -- binding instead of passing through.
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  blocked_order := jsonb_set(
    jsonb_set(fixture.order_input, '{items,0,product_id}', to_jsonb(fixture.ordinary_product_id::text)),
    '{checkout_idempotency_key}', '"redvault-private-pilot-full-schema-staging-disabled-negative"'
  );
  blocked_quote := jsonb_set(
    jsonb_set(fixture.quote, '{lines,0,productId}', to_jsonb(fixture.ordinary_product_id::text)),
    '{groups,0,productId}', to_jsonb(fixture.ordinary_product_id::text)
  );
  PERFORM pg_catalog.set_config('request.jwt.claims', jsonb_build_object(
    'sub', '70261bce-d358-45a4-9ede-8b9d71fb3bd9',
    'role', 'authenticated',
    'storefront_redvault_customer_email', 'redvault-pilot-full-schema@example.test',
    'storefront_order_context', 'route',
    'storefront_order_merchant_id', '6b5cb8a4-5575-456c-b936-8cdfae30db74'
  )::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.create_storefront_redvault_order(
      blocked_order, blocked_quote,
      public.redvault_private_pilot_test_route_proof(blocked_order, blocked_quote)
    );
    RAISE EXCEPTION 'unstaged disabled pilot order unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_order_binding_mismatch' THEN
    RAISE EXCEPTION 'unstaged disabled pilot order wrong result:%', COALESCE(caught, 'accepted');
  END IF;
  RESET ROLE;
END;
$$;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  staging_order jsonb;
  staging_quote jsonb;
  created record;
  reserved record;
BEGIN
  -- Disabled, never-bound policy WITH the staging flag (staging_test_mode
  -- shape): the pilot account's ordinary order must pass binding and
  -- reserve through the normal path instead of raising pilot errors by
  -- identity alone.
  PERFORM private.enable_uba_redvault_staging_passthrough();
  IF NOT EXISTS (
    SELECT 1 FROM private.uba_redvault_live_pilot_policy
    WHERE singleton AND staging_test_mode IS TRUE
  ) THEN RAISE EXCEPTION 'staging flag was not enabled'; END IF;
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  staging_order := jsonb_set(
    jsonb_set(fixture.order_input, '{items,0,product_id}', to_jsonb(fixture.ordinary_product_id::text)),
    '{checkout_idempotency_key}', '"redvault-private-pilot-full-schema-staging-passthrough"'
  );
  staging_quote := jsonb_set(
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
    '{groups,0,key}', '"redvault-staging-fixture"'
  );
  PERFORM pg_catalog.set_config('request.jwt.claims', jsonb_build_object(
    'sub', '70261bce-d358-45a4-9ede-8b9d71fb3bd9',
    'role', 'authenticated',
    'storefront_redvault_customer_email', 'redvault-pilot-full-schema@example.test',
    'storefront_order_context', 'route',
    'storefront_order_merchant_id', '6b5cb8a4-5575-456c-b936-8cdfae30db74'
  )::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO STRICT created
  FROM public.create_storefront_redvault_order(
    staging_order, staging_quote,
    public.redvault_private_pilot_test_route_proof(staging_order, staging_quote)
  );
  IF created.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'staging_passthrough_create_unexpected';
  END IF;
  SELECT * INTO STRICT reserved
  FROM public.reserve_storefront_redvault_payment_attempt_v3(created.id);
  IF reserved.attempt_id IS NULL OR reserved.amount_kobo IS DISTINCT FROM 9500 THEN
    RAISE EXCEPTION 'staging_passthrough_reservation_unexpected';
  END IF;
  RESET ROLE;
  PERFORM private.disable_uba_redvault_staging_passthrough();
  IF NOT EXISTS (
    SELECT 1 FROM private.uba_redvault_live_pilot_policy
    WHERE singleton AND staging_test_mode IS FALSE
  ) THEN RAISE EXCEPTION 'staging flag was not disabled'; END IF;
END;
$$;

