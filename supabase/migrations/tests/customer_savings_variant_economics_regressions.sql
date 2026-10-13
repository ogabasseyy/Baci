BEGIN;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := 'f0b0ed78-0000-4000-8000-000000000001';
  v_customer_id uuid := 'f0b0ed78-0000-4000-8000-000000000002';
  v_product_id uuid := 'f0b0ed78-0000-4000-8000-000000000003';
  v_cheap_variant_id uuid := 'f0b0ed78-0000-4000-8000-000000000004';
  v_expensive_variant_id uuid := 'f0b0ed78-0000-4000-8000-000000000005';
  v_legacy_goal_id uuid := 'f0b0ed78-0000-4000-8000-000000000006';
  v_redemption_goal_id uuid := 'f0b0ed78-0000-4000-8000-000000000007';
  v_order_id uuid := 'f0b0ed78-0000-4000-8000-000000000008';
  v_snapshot jsonb;
  v_rejected boolean;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (v_merchant_id, 'variant-economics@example.com', 'Variant Economics', 'variant-economics');
  INSERT INTO public.customers (id, merchant_id, email, first_name)
  VALUES (v_customer_id, v_merchant_id, 'customer@example.com', 'Customer');
  INSERT INTO public.products (id, merchant_id, name, price, status, condition, images)
  VALUES (v_product_id, v_merchant_id, 'Savings device', 90, 'active', 'product-condition', '["product.jpg"]');

  INSERT INTO public.customer_savings_goals (
    id, merchant_id, customer_id, product_id, title, product_snapshot, target_amount,
    current_amount, contribution_amount, contribution_frequency, start_date, maturity_date,
    source_mode, status, completed_at, terms_accepted_at, non_withdrawable_accepted_at
  ) VALUES (
    v_legacy_goal_id, v_merchant_id, v_customer_id, v_product_id, 'Legacy',
    '{"name":"Historical device","condition":"historical-condition","image":"historical.jpg","price":90,"cataloguePrice":90}'::jsonb,
    90, 90, 10, 'daily', current_date, current_date, 'manual', 'completed', now(), now(), now()
  );

  INSERT INTO public.product_variants (
    id, product_id, merchant_id, attributes, price_override, condition, primary_image
  )
  VALUES
    (v_cheap_variant_id, v_product_id, v_merchant_id, '{"storage":"128GB"}', 90, 'cheap-condition', 'cheap.jpg'),
    (v_expensive_variant_id, v_product_id, v_merchant_id, '{"storage":"256GB"}', 120, NULL, NULL);

  v_rejected := false;
  BEGIN
    PERFORM 1 FROM public.resolve_completed_customer_savings_goal_variant(
      v_legacy_goal_id, v_customer_id, v_merchant_id, v_customer_id, v_expensive_variant_id
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'legacy recovery accepted a variant above the locked amount';
  END IF;

  PERFORM 1 FROM public.resolve_completed_customer_savings_goal_variant(
    v_legacy_goal_id, v_customer_id, v_merchant_id, v_customer_id, v_cheap_variant_id
  );
  SELECT g.product_snapshot INTO v_snapshot
  FROM public.customer_savings_goals AS g
  WHERE g.id = v_legacy_goal_id;
  IF (v_snapshot->>'price')::numeric IS DISTINCT FROM 90
    OR (v_snapshot->>'cataloguePrice')::numeric IS DISTINCT FROM 90
    OR v_snapshot->>'variantId' IS DISTINCT FROM v_cheap_variant_id::text
    OR v_snapshot->>'condition' IS DISTINCT FROM 'cheap-condition'
    OR v_snapshot->>'image' IS DISTINCT FROM 'cheap.jpg'
    OR v_snapshot->>'name' IS DISTINCT FROM 'Savings device'
  THEN
    RAISE EXCEPTION 'legacy recovery changed the locked quote: %', v_snapshot;
  END IF;

  INSERT INTO public.customer_savings_goals (
    id, merchant_id, customer_id, product_id, variant_id, title, product_snapshot,
    target_amount, current_amount, contribution_amount, contribution_frequency, start_date,
    maturity_date, source_mode, status, terms_accepted_at, non_withdrawable_accepted_at
  ) VALUES (
    v_redemption_goal_id, v_merchant_id, v_customer_id, v_product_id, v_cheap_variant_id,
    'Redeem', '{"name":"Historical device","price":90,"cataloguePrice":90}'::jsonb,
    90, 90, 10, 'daily', current_date, current_date, 'manual', 'completed', now(), now()
  );
  INSERT INTO public.orders (id, merchant_id, customer_id, order_number, total)
  VALUES (v_order_id, v_merchant_id, v_customer_id, 'variant-economics-order', 1);
  INSERT INTO public.order_items (order_id, product_id, variant_id, name, price, quantity)
  VALUES (v_order_id, v_product_id, v_cheap_variant_id, 'Savings device', 1, 1);

  v_rejected := false;
  BEGIN
    PERFORM 1 FROM public.redeem_savings_for_order(
      v_customer_id, v_merchant_id, v_order_id, v_redemption_goal_id, 90, 'over-order-total'
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'redemption exceeded the locked order total';
  END IF;

  UPDATE public.customer_savings_goals
  SET product_snapshot = '{"name":"forged","price":1}'::jsonb
  WHERE id = v_redemption_goal_id;
  SELECT g.product_snapshot INTO v_snapshot
  FROM public.customer_savings_goals AS g
  WHERE g.id = v_redemption_goal_id;
  IF v_snapshot->>'name' = 'forged'
    OR (v_snapshot->>'price')::numeric IS DISTINCT FROM 90
    OR v_snapshot->>'variantId' IS DISTINCT FROM v_cheap_variant_id::text
  THEN
    RAISE EXCEPTION 'same-identity snapshot update was not canonicalized: %', v_snapshot;
  END IF;
END;
$$;

ROLLBACK;
