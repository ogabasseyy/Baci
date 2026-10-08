-- redvault-private-pilot-full-schema-reservations.sql
-- Part 3/6: enables the pilot, creates and reserves the protected order, and asserts the activation, binding-negative, rotation, and reservation outcomes. Post-reservation guards live in the postreserve part.
--
-- Runs concatenated with the other parts in filename order inside one
-- psql session/transaction (see run-redvault-private-pilot-full-schema.sh);
-- do not run standalone.

SELECT private.configure_uba_redvault_live_pilot(
  true, (SELECT product_id FROM redvault_private_pilot_case), pg_catalog.now() + interval '1 hour'
);

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  rotated uuid;
  tracked uuid;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  -- No pilot-user applications yet: rotating the binding stays allowed;
  -- switch away and back so the suite continues on the fixture product.
  rotated := public.redvault_private_pilot_probe_product('REDVAULT rotation probe product');
  PERFORM private.configure_uba_redvault_live_pilot(true, rotated, pg_catalog.now() + interval '1 hour');
  IF NOT EXISTS (SELECT 1 FROM private.uba_redvault_live_pilot_policy WHERE singleton AND enabled IS TRUE AND product_id = rotated) THEN
    RAISE EXCEPTION 'pilot_applicationless_rotation_rejected';
  END IF;
  PERFORM private.configure_uba_redvault_live_pilot(true, fixture.product_id, pg_catalog.now() + interval '1 hour');
  IF NOT EXISTS (SELECT 1 FROM private.uba_redvault_live_pilot_policy WHERE singleton AND enabled IS TRUE AND product_id = fixture.product_id) THEN
    RAISE EXCEPTION 'pilot_rotation_restore_rejected';
  END IF;
  -- Serialized tracking would poison pilot checkout, so activation must reject tracked products.
  tracked := public.redvault_private_pilot_probe_product('REDVAULT tracked probe product', 'serialized_strict');
  BEGIN
    PERFORM private.configure_uba_redvault_live_pilot(true, tracked, pg_catalog.now() + interval '1 hour');
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_product_not_dedicated' THEN
    RAISE EXCEPTION 'pilot_tracked_product_wrong_result:%', COALESCE(caught, 'accepted');
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
  prefilled_order jsonb;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  -- A pilot-shaped order carrying fulfillment metadata must fail binding:
  -- the fulfillment guard only fires on UPDATE, so creation is the last
  -- chance to reject pre-populated tracking.
  prefilled_order := jsonb_set(
    jsonb_set(fixture.order_input, '{tracking_number}', '"RV-PREFILL-PROBE"'),
    '{checkout_idempotency_key}', '"redvault-private-pilot-full-schema-prefilled"'
  );
  BEGIN
    PERFORM * FROM public.create_storefront_redvault_order(
      prefilled_order, fixture.quote,
      public.redvault_private_pilot_test_route_proof(prefilled_order, fixture.quote)
    );
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_order_binding_mismatch' THEN
    RAISE EXCEPTION 'pilot_prefilled_fulfillment_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
END;
$$;

-- Variants enabled after activation must fail binding at order time:
-- availability is advisory, the quote never reads has_variants, and
-- the order RPC accepts a null variant, so the order guard rechecks
-- the locked catalog row. Flip the flag as the session owner (the
-- authenticated test role cannot update the catalog row).
RESET ROLE;
UPDATE public.products SET has_variants = true
WHERE id = (SELECT product_id FROM redvault_private_pilot_case);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  variant_order jsonb;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  variant_order := jsonb_set(
    fixture.order_input,
    '{checkout_idempotency_key}', '"redvault-private-pilot-full-schema-variant-enabled"'
  );
  BEGIN
    PERFORM * FROM public.create_storefront_redvault_order(
      variant_order, fixture.quote,
      public.redvault_private_pilot_test_route_proof(variant_order, fixture.quote)
    );
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_order_binding_mismatch' THEN
    RAISE EXCEPTION 'pilot_variant_enabled_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
END;
$$;

RESET ROLE;
UPDATE public.products SET has_variants = false
WHERE id = (SELECT product_id FROM redvault_private_pilot_case);

-- Archiving after activation must fail binding at order time: neither
-- the quote nor the order RPC reads product status, so the order guard
-- requires active on the same locked product read. Same role dance as
-- the variant case above.
RESET ROLE;
UPDATE public.products SET status = 'archived'
WHERE id = (SELECT product_id FROM redvault_private_pilot_case);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  archived_order jsonb;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  archived_order := jsonb_set(
    fixture.order_input,
    '{checkout_idempotency_key}', '"redvault-private-pilot-full-schema-archived"'
  );
  BEGIN
    PERFORM * FROM public.create_storefront_redvault_order(
      archived_order, fixture.quote,
      public.redvault_private_pilot_test_route_proof(archived_order, fixture.quote)
    );
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_order_binding_mismatch' THEN
    RAISE EXCEPTION 'pilot_archived_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
END;
$$;

RESET ROLE;
UPDATE public.products SET status = 'active'
WHERE id = (SELECT product_id FROM redvault_private_pilot_case);

RESET ROLE;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  rotated uuid;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  -- Application exists, no reservation yet: rotating must fail so the
  -- used test product stays quarantined; the policy must be untouched.
  rotated := public.redvault_private_pilot_probe_product('REDVAULT rotation probe product');
  BEGIN
    PERFORM private.configure_uba_redvault_live_pilot(true, rotated, pg_catalog.now() + interval '1 hour');
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_bound_product_immutable' THEN
    RAISE EXCEPTION 'pilot_product_rotation_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.uba_redvault_live_pilot_policy WHERE singleton AND enabled IS TRUE AND product_id = fixture.product_id) THEN
    RAISE EXCEPTION 'pilot_failed_rotation_changed_policy';
  END IF;
  -- Same-product recovery after disable must still work: the pilot
  -- order's own lines are excluded from the prior-use check.
  PERFORM private.configure_uba_redvault_live_pilot(false, NULL, NULL);
  PERFORM private.configure_uba_redvault_live_pilot(true, fixture.product_id, pg_catalog.now() + interval '1 hour');
  IF NOT EXISTS (SELECT 1 FROM private.uba_redvault_live_pilot_policy WHERE singleton AND enabled IS TRUE AND product_id = fixture.product_id) THEN
    RAISE EXCEPTION 'pilot_same_product_reenable_rejected';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;

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

