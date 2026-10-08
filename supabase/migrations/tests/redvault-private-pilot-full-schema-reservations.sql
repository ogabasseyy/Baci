-- redvault-private-pilot-full-schema-reservations.sql
-- Part 3/5: enables the pilot, creates and reserves the protected order, and asserts proof replay, the reservation binding, and the attempt cap.
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
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  -- With no pilot-user applications yet, rotating the binding stays
  -- allowed; switch away and back so the suite continues on the fixture.
  INSERT INTO public.products(
    id, merchant_id, brand, name, price, condition, vat_category_code, vat_rate,
    has_variants, taxable, manage_stock, stock_quantity, stock, status
  )
  VALUES (
    extensions.gen_random_uuid(), '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'REDVAULT fixture',
    'REDVAULT rotation probe product', 100, 'new', 'S', 0, false, false, false, 1, 1, 'active'
  )
  RETURNING id INTO rotated;
  PERFORM private.configure_uba_redvault_live_pilot(true, rotated, pg_catalog.now() + interval '1 hour');
  IF NOT EXISTS (SELECT 1 FROM private.uba_redvault_live_pilot_policy WHERE singleton AND enabled IS TRUE AND product_id = rotated) THEN
    RAISE EXCEPTION 'pilot_applicationless_rotation_rejected';
  END IF;
  PERFORM private.configure_uba_redvault_live_pilot(true, fixture.product_id, pg_catalog.now() + interval '1 hour');
  IF NOT EXISTS (SELECT 1 FROM private.uba_redvault_live_pilot_policy WHERE singleton AND enabled IS TRUE AND product_id = fixture.product_id) THEN
    RAISE EXCEPTION 'pilot_rotation_restore_rejected';
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

RESET ROLE;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  rotated uuid;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  -- The pilot user has an application but no reservation yet: rotating to
  -- a different product must fail so the used test product stays
  -- quarantined, and the failed rotation must leave the policy untouched.
  INSERT INTO public.products(
    id, merchant_id, brand, name, price, condition, vat_category_code, vat_rate,
    has_variants, taxable, manage_stock, stock_quantity, stock, status
  )
  VALUES (
    extensions.gen_random_uuid(), '6b5cb8a4-5575-456c-b936-8cdfae30db74', 'REDVAULT fixture',
    'REDVAULT rotation probe product', 100, 'new', 'S', 0, false, false, false, 1, 1, 'active'
  )
  RETURNING id INTO rotated;
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

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  -- Satisfy the unscoped-write trigger so these probes isolate the pilot
  -- guard deterministically regardless of trigger firing order. The context
  -- row is removed at the end of this block, mirroring the protected RPCs.
  INSERT INTO private.uba_redvault_write_context VALUES (pg_catalog.txid_current())
  ON CONFLICT DO NOTHING;
  BEGIN
    UPDATE public.orders SET shipping_status = 'shipped' WHERE id = fixture.order_id;
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_physical_fulfillment_blocked' THEN
    RAISE EXCEPTION 'preapproval_pilot_fulfillment_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
  caught := NULL;
  BEGIN
    UPDATE public.orders SET tracking_number = 'RV-PILOT-PROBE' WHERE id = fixture.order_id;
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_physical_fulfillment_blocked' THEN
    RAISE EXCEPTION 'preapproval_pilot_tracking_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
  DELETE FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current();
END;
$$;

DO $$
DECLARE
  fixture redvault_private_pilot_case%ROWTYPE;
  customer_id uuid;
  goal_id uuid;
  caught text;
BEGIN
  SELECT * INTO STRICT fixture FROM redvault_private_pilot_case;
  INSERT INTO public.customers(merchant_id, email)
  VALUES ('6b5cb8a4-5575-456c-b936-8cdfae30db74', 'pilot-saver@example.test')
  RETURNING id INTO customer_id;
  INSERT INTO public.customer_savings_goals(merchant_id, customer_id, product_id, title, target_amount, contribution_amount, contribution_frequency)
  VALUES ('6b5cb8a4-5575-456c-b936-8cdfae30db74', customer_id, fixture.product_id, 'pilot probe', 100, 10, 'weekly')
  RETURNING id INTO goal_id;
  BEGIN
    INSERT INTO public.customer_savings_redemptions(goal_id, merchant_id, customer_id, order_id, amount, idempotency_key)
    VALUES (goal_id, '6b5cb8a4-5575-456c-b936-8cdfae30db74', customer_id, fixture.order_id, 5, 'pilot-redemption-probe');
  EXCEPTION WHEN OTHERS THEN caught := SQLERRM;
  END;
  IF caught IS DISTINCT FROM 'redvault_pilot_wallet_or_savings_credit_blocked' THEN
    RAISE EXCEPTION 'postreserve_pilot_redemption_wrong_result:%', COALESCE(caught, 'accepted');
  END IF;
END;
$$;

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

