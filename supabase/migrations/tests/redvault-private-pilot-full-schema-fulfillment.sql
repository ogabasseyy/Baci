-- redvault-private-pilot-full-schema-fulfillment.sql
-- Part 4/5: pre-approval fulfillment blocks (orders, shipments, items), expiry/disable transitions, and non-pilot compatibility.
--
-- Runs concatenated with the other parts in filename order inside one
-- psql session/transaction (see run-redvault-private-pilot-full-schema.sh);
-- do not run standalone.

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
  recorded record;
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
  -- An in-flight provider outcome must still land after expiry; v2 delegates
  -- the state write to this same v1 function. Indeterminate carries no
  -- authorization URL, preserving the no-provider-simulation invariant below.
  SELECT * INTO STRICT recorded
  FROM public.record_storefront_redvault_payment_attempt_initialization(
    fixture.attempt_id, 'indeterminate', NULL
  );
  IF recorded.state IS DISTINCT FROM 'indeterminate'
    OR recorded.authorization_url IS NOT NULL THEN
    RAISE EXCEPTION 'expired_provider_outcome_wrong_result';
  END IF;
END;
$$;

