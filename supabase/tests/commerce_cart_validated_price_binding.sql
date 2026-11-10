-- Regression: unchanged negotiated/voucher effective prices must not hide a
-- changed validated catalog price between prepare and order binding.
-- These are binder-level disposable fixtures: the voucher pair tests snapshot
-- classification and stale rejection only, not voucher issuance or fulfillment.
-- Its quiz_voucher proof uses the established synthetic `quiz-proof-a4` leaf
-- fixture from commerce_cart_order_binding.sql.
-- The separate negotiated REDVAULT case enters the final wrapper and must fail
-- before its distinct draft leaf; the leaf itself is deliberately not mocked.
DO $$
DECLARE
  m uuid := '11111111-1111-4111-8111-111111111111';
  p uuid := '44444444-4444-4444-8444-444444444444';
  c uuid;
  g uuid;
  l uuid;
  sid uuid;
  reviewed jsonb;
  args jsonb;
  lane text;
  effective numeric;
  expected_calls bigint;
  previous_stub_failure text;
  order_payload jsonb;
  quote_payload jsonb := '{}'::jsonb;
  submitted_items jsonb;
  variant text;
BEGIN
  UPDATE public.products
  SET price = 15, status = 'active', manage_stock = false,
      stock = 10, stock_quantity = 10,
      inventory_tracking_policy = 'serialized_then_unlimited'
  WHERE id = p;

  FOR lane, effective IN
    SELECT cases.lane, cases.effective
    FROM (VALUES
      ('negotiated', 1490::numeric),
      ('voucher', 0::numeric),
      ('redvault_negotiated', 1490::numeric)
    ) AS cases(lane, effective)
    WHERE current_setting('test.cart_price_drift_lane', true) IS NULL
      OR cases.lane = current_setting('test.cart_price_drift_lane', true)
  LOOP
    c := gen_random_uuid();
    g := gen_random_uuid();
    INSERT INTO public.commerce_carts(id, merchant_id, expires_at)
    VALUES (c, m, now() + interval '1 hour');
    INSERT INTO public.commerce_cart_grants(id, merchant_id, cart_id, principal_id,
      allowed_operations, expires_at)
    VALUES (g, m, c, 'price-drift-' || lane,
      ARRAY['add','set_quantity','remove','clear','replace','set_assurance','set_negotiated_price'],
      now() + interval '1 hour');
    INSERT INTO public.commerce_cart_lines(merchant_id, cart_id, product_id, quantity,
      negotiated_unit_price_minor, negotiation_status, voucher_token, voucher_award_id)
    VALUES (m, c, p, 1,
      CASE WHEN lane IN ('negotiated','redvault_negotiated') THEN 1490 END,
      CASE WHEN lane IN ('negotiated','redvault_negotiated') THEN 'accepted' END,
      CASE WHEN lane = 'voucher' THEN 'validated-price-voucher' END,
      CASE WHEN lane = 'voucher' THEN 'dddddddd-4500-4000-8000-000000000099'::uuid END)
    RETURNING id INTO l;

    reviewed := public.commerce_cart_build_checkout_snapshot(m, c);
    IF (reviewed->'lines'->0->>'effectiveUnitPriceMinor')::numeric IS DISTINCT FROM effective
      OR (reviewed->'lines'->0->>'validatedUnitPriceMinor')::numeric IS DISTINCT FROM 1500 THEN
      RAISE EXCEPTION 'bad % regression setup snapshot: %', lane, reviewed->'lines'->0;
    END IF;
    INSERT INTO public.commerce_cart_checkout_sessions(merchant_id, cart_id,
      checkout_generation, cart_version_reviewed, principal_id, preparing_grant_id,
      reviewed_snapshot, expires_at)
    VALUES (m, c, 1, 1, 'price-drift-' || lane, g, reviewed, now() + interval '30 minutes')
    RETURNING id INTO sid;

    UPDATE public.products SET price = 15.05 WHERE id = p;
    reviewed := public.commerce_cart_build_checkout_snapshot(m, c);
    IF (reviewed->'lines'->0->>'effectiveUnitPriceMinor')::numeric IS DISTINCT FROM effective
      OR (reviewed->'lines'->0->>'validatedUnitPriceMinor')::numeric IS DISTINCT FROM 1505
      OR (reviewed->'estimates'->>'unavailableCount')::integer <> 0 THEN
      RAISE EXCEPTION 'bad % price-drift regression state: %', lane, reviewed->'lines'->0;
    END IF;
    args := jsonb_build_object(
      'p_merchant_id', m, 'p_cart_id', c, 'p_cart_version', 1,
      'p_cart_principal_id', 'price-drift-' || lane,
      'p_customer_email', 'fixture@example.invalid', 'p_customer_name', 'Fixture',
      'p_checkout_idempotency_key', 'price-drift-' || lane,
      'p_checkout_request_hash', 'price-drift-v1-' || lane,
      -- Keep the declared total consistent with the reviewed line; the binder
      -- still derives line authority from its snapshot, never this field.
      'p_expected_total', effective / 100,
      'p_items', jsonb_build_array(jsonb_build_object(
        'cart_line_id', l, 'product_id', p, 'quantity', 1,
        'price', effective / 100, 'variant_attributes', '{}'::jsonb,
        'voucher_award_id', CASE WHEN lane = 'voucher'
          THEN 'dddddddd-4500-4000-8000-000000000099' END))
    );
    variant := CASE
      WHEN lane = 'voucher' THEN 'quiz_voucher'
      WHEN lane = 'redvault_negotiated' THEN 'redvault'
      ELSE 'base'
    END;
    IF variant = 'quiz_voucher' THEN
      args := args || jsonb_build_object(
        'p_route_proof', jsonb_build_object('attempt', 'quiz-proof-a4')
      );
    END IF;
    IF variant = 'redvault' THEN
      submitted_items := args->'p_items';
      order_payload := jsonb_build_object(
        'merchant_id', m, 'customer_email', 'fixture@example.invalid',
        'payment_method', 'uba_redvault',
        'checkout_idempotency_key', 'price-drift-' || lane,
        'items', submitted_items
      );
      args := args || jsonb_build_object(
        'p_payment_method', 'uba_redvault',
        'p_redvault_order', order_payload,
        'p_redvault_quote', quote_payload,
        'p_redvault_route_proof', jsonb_build_object(
          'valid', true, 'payload', jsonb_build_object('order', order_payload, 'quote', quote_payload))
      );
    END IF;
    PERFORM set_config('request.jwt.claims', jsonb_build_object(
      'role','authenticated', 'storefront_order_context','route',
      'storefront_order_merchant_id',m,
      'storefront_redvault_customer_email','fixture@example.invalid')::text, true);
    SELECT count(*) INTO expected_calls FROM public.order_stub_calls;
    IF variant IN ('base', 'quiz_voucher') THEN
      SELECT fail_with INTO previous_stub_failure
      FROM public.order_stub_behavior WHERE id = 1;
      UPDATE public.order_stub_behavior
      SET fail_with = 'unexpected_order_leaf_entry' WHERE id = 1;
    END IF;
    BEGIN
      PERFORM public.create_storefront_order_with_cart_binding(variant, sid, 1, args);
      RAISE EXCEPTION 'validated catalog price drift was accepted for %', lane;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'cart_checkout_stale' THEN RAISE; END IF;
    END;
    IF variant IN ('base', 'quiz_voucher') THEN
      UPDATE public.order_stub_behavior
      SET fail_with = previous_stub_failure WHERE id = 1;
    END IF;
    IF (SELECT count(*) FROM public.order_stub_calls) IS DISTINCT FROM expected_calls THEN
      RAISE EXCEPTION 'stale % checkout reached the order RPC', lane;
    END IF;
    UPDATE public.products SET price = 15 WHERE id = p;
  END LOOP;
END $$;

-- The migration accepts only a complete patch or the original two anchors;
-- the mixed one-patched/one-unpatched state must fail closed.
DO $$
DECLARE
  v_definition text := pg_get_functiondef(
    'public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)'::regprocedure
  );
  v_old constant text := 'jsonb_build_array(line->>''id'',line->''effectiveUnitPriceMinor'')';
  v_new constant text := 'jsonb_build_array(line->>''id'',line->''effectiveUnitPriceMinor'',line->''validatedUnitPriceMinor'')';
  v_partial text;
  v_old_count integer;
  v_new_count integer;
BEGIN
  IF has_function_privilege('anon', 'public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.create_storefront_order_with_cart_binding(text,uuid,integer,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'binding grants changed';
  END IF;
  IF length(v_definition) - length(replace(v_definition, v_new, '')) <> 2 * length(v_new)
    OR position(v_old IN v_definition) > 0 THEN
    RAISE EXCEPTION 'binding migration did not install exactly two complete comparisons';
  END IF;
  v_partial := overlay(v_definition PLACING v_old FROM position(v_new IN v_definition) FOR length(v_new));
  -- Revert exactly one replacement to synthesize the formerly dangerous
  -- mixed state and prove its anchor counts trigger the migration rejection.
  v_old_count := (length(v_partial) - length(replace(v_partial, v_old, ''))) / length(v_old);
  v_new_count := (length(v_partial) - length(replace(v_partial, v_new, ''))) / length(v_new);
  IF v_old_count <> 1 OR v_new_count <> 1 THEN
    RAISE EXCEPTION 'mixed migration state was not recognized as partial';
  END IF;
END $$;
