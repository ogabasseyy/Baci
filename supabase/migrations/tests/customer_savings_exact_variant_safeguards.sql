BEGIN;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := '99b0ed78-0000-4000-8000-000000000001';
  v_customer_id uuid := '99b0ed78-0000-4000-8000-000000000003';
  v_product_id uuid := '99b0ed78-0000-4000-8000-000000000004';
  v_simple_product_id uuid := '99b0ed78-0000-4000-8000-000000000005';
  v_visible_variant_id uuid := '99b0ed78-0000-4000-8000-000000000006';
  v_anchor_id uuid := '99b0ed78-0000-4000-8000-000000000007';
  v_other_product_id uuid := '99b0ed78-0000-4000-8000-000000000008';
  v_other_variant_id uuid := '99b0ed78-0000-4000-8000-000000000013';
  v_legacy_goal_id uuid := '99b0ed78-0000-4000-8000-000000000009';
  v_order_id uuid := '99b0ed78-0000-4000-8000-000000000010';
  v_result record;
  v_snapshot jsonb;
  v_rejected boolean;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (v_merchant_id, 'exact-variant@example.com', 'Exact Variant', 'exact-variant');

  INSERT INTO public.customers (id, merchant_id, email, first_name)
  VALUES (v_customer_id, v_merchant_id, 'exact-customer@example.com', 'Exact');

  INSERT INTO public.products (id, merchant_id, name, price, status)
  VALUES
    (v_product_id, v_merchant_id, 'Visible device', 100, 'active'),
    (v_simple_product_id, v_merchant_id, 'Serialized simple device', 90, 'active'),
    (v_other_product_id, v_merchant_id, 'Other device', 100, 'active');

  INSERT INTO public.product_variants (
    id, product_id, merchant_id, attributes, price_override, is_inventory_anchor
  )
  VALUES
    (v_visible_variant_id, v_product_id, v_merchant_id, '{"storage":"256GB"}', 120, false),
    (v_anchor_id, v_simple_product_id, v_merchant_id, '{}', NULL, true),
    (v_other_variant_id, v_other_product_id, v_merchant_id, '{}', 100, false);

  v_rejected := false;
  BEGIN
    INSERT INTO public.customer_savings_goals (
      merchant_id, customer_id, product_id, title, target_amount, contribution_amount,
      contribution_frequency, start_date, maturity_date, source_mode,
      terms_accepted_at, non_withdrawable_accepted_at
    ) VALUES (
      v_merchant_id, v_customer_id, v_product_id, 'Missing variant', 120, 10,
      'daily', current_date, current_date, 'manual', now(), now()
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'visible variants must require an exact variant';
  END IF;

  v_rejected := false;
  BEGIN
    INSERT INTO public.customer_savings_goals (
      merchant_id, customer_id, product_id, variant_id, title, target_amount,
      contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
      terms_accepted_at, non_withdrawable_accepted_at
    ) VALUES (
      v_merchant_id, v_customer_id, v_product_id, v_other_variant_id, 'Wrong variant', 120,
      10, 'daily', current_date, current_date, 'manual', now(), now()
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'cross-product variant unexpectedly succeeded';
  END IF;

  v_rejected := false;
  BEGIN
    INSERT INTO public.customer_savings_goals (
      merchant_id, customer_id, product_id, variant_id, title, target_amount,
      contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
      terms_accepted_at, non_withdrawable_accepted_at
    ) VALUES (
      v_merchant_id, v_customer_id, v_simple_product_id, v_anchor_id, 'Anchor', 90,
      10, 'daily', current_date, current_date, 'manual', now(), now()
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'inventory anchors must not be customer-selectable';
  END IF;

  INSERT INTO public.customer_savings_goals (
    merchant_id, customer_id, product_id, title, target_amount, contribution_amount,
    contribution_frequency, start_date, maturity_date, source_mode,
    terms_accepted_at, non_withdrawable_accepted_at
  ) VALUES (
    v_merchant_id, v_customer_id, v_simple_product_id, 'Simple', 90, 10,
    'daily', current_date, current_date, 'manual', now(), now()
  );

  v_rejected := false;
  BEGIN
    PERFORM * FROM public.create_customer_savings_goal(
      v_customer_id, v_merchant_id, v_product_id, v_visible_variant_id, 'Forged',
      '{"name":"Forged","price":1}'::jsonb, 119, 0, 10, 'daily', NULL,
      current_date, current_date, 'manual', NULL, now(), now(), NULL, NULL, 0,
      '{}'::jsonb, 'exact-variant:below-price'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'underpriced direct creation unexpectedly succeeded';
  END IF;

  SELECT goal_id, success INTO v_result FROM public.create_customer_savings_goal(
    v_customer_id, v_merchant_id, v_product_id, v_visible_variant_id, 'Forged',
    '{"name":"Forged","price":1}'::jsonb, 140, 0, 10, 'daily', NULL,
    current_date, current_date, 'manual', NULL, now(), now(), NULL, NULL, 0,
    '{}'::jsonb, 'exact-variant:authoritative-snapshot'
  );
  SELECT product_snapshot INTO v_snapshot
  FROM public.customer_savings_goals WHERE id = v_result.goal_id;
  IF v_snapshot->>'name' IS DISTINCT FROM 'Visible device'
    OR (v_snapshot->>'cataloguePrice')::numeric IS DISTINCT FROM 120::numeric
    OR v_snapshot->>'variantId' IS DISTINCT FROM v_visible_variant_id::text
  THEN
    RAISE EXCEPTION 'direct creation did not store an authoritative snapshot: %', v_snapshot;
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM * FROM public.swap_customer_savings_goal_device(
      v_result.goal_id, v_customer_id, v_merchant_id, v_customer_id, v_product_id,
      v_visible_variant_id, 'Forged swap', '{"name":"Forged swap","price":1}'::jsonb, 119
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'underpriced direct swap unexpectedly succeeded';
  END IF;

  PERFORM 1 FROM public.swap_customer_savings_goal_device(
    v_result.goal_id, v_customer_id, v_merchant_id, v_customer_id, v_product_id,
    v_visible_variant_id, 'Forged swap', '{"name":"Forged swap","price":1}'::jsonb, 150
  );
  SELECT product_snapshot INTO v_snapshot
  FROM public.customer_savings_goals WHERE id = v_result.goal_id;
  IF v_snapshot->>'name' IS DISTINCT FROM 'Visible device'
    OR (v_snapshot->>'cataloguePrice')::numeric IS DISTINCT FROM 120::numeric
  THEN
    RAISE EXCEPTION 'direct swap did not store an authoritative snapshot: %', v_snapshot;
  END IF;

  INSERT INTO public.customer_savings_goals (
    id, merchant_id, customer_id, product_id, title, target_amount, current_amount,
    contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
    status, completed_at, terms_accepted_at, non_withdrawable_accepted_at
  ) VALUES (
    v_legacy_goal_id, v_merchant_id, v_customer_id, v_simple_product_id, 'Legacy', 90, 90,
    10, 'daily', current_date, current_date, 'manual', 'completed', now(), now(), now()
  );

  INSERT INTO public.product_variants (
    id, product_id, merchant_id, attributes, price_override, is_inventory_anchor
  ) VALUES (
    '99b0ed78-0000-4000-8000-000000000011', v_simple_product_id, v_merchant_id,
    '{"storage":"128GB"}', 90, false
  ), (
    '99b0ed78-0000-4000-8000-000000000012', v_simple_product_id, v_merchant_id,
    '{"storage":"256GB"}', 120, false
  );

  UPDATE public.customer_savings_goals SET title = 'Legacy renamed'
  WHERE id = v_legacy_goal_id;

  v_rejected := false;
  BEGIN
    UPDATE public.customer_savings_goals SET product_id = v_product_id
    WHERE id = v_legacy_goal_id;
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'legacy null variant goal retarget unexpectedly succeeded';
  END IF;

  SELECT goal_id, success INTO v_result FROM public.resolve_completed_customer_savings_goal_variant(
    v_legacy_goal_id, v_customer_id, v_merchant_id, v_customer_id,
    '99b0ed78-0000-4000-8000-000000000011'
  );
  IF v_result.success IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'legacy completed exact selection did not succeed';
  END IF;

  INSERT INTO public.orders (id, merchant_id, customer_id, order_number, total)
  VALUES (v_order_id, v_merchant_id, v_customer_id, 'exact-variant-order', 90);
  INSERT INTO public.order_items (order_id, product_id, variant_id, name, price, quantity)
  VALUES (v_order_id, v_simple_product_id, '99b0ed78-0000-4000-8000-000000000012', 'Wrong', 90, 1);
  v_rejected := false;
  BEGIN
    PERFORM 1 FROM public.redeem_savings_for_order(
      v_customer_id, v_merchant_id, v_order_id, v_legacy_goal_id, 90, 'exact-variant:mismatch'
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'mismatched exact-variant redemption unexpectedly succeeded';
  END IF;
  UPDATE public.order_items
  SET variant_id = '99b0ed78-0000-4000-8000-000000000011', name = 'Exact'
  WHERE order_id = v_order_id;
  PERFORM 1 FROM public.redeem_savings_for_order(
    v_customer_id, v_merchant_id, v_order_id, v_legacy_goal_id, 90, 'exact-variant:redeem'
  );
END;
$$;

ROLLBACK;
