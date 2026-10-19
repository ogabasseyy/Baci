BEGIN;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := 'f1b0ed78-0000-4000-8000-000000000001';
  v_customer_id uuid := 'f1b0ed78-0000-4000-8000-000000000002';
  v_product_id uuid := 'f1b0ed78-0000-4000-8000-000000000003';
  v_variant_id uuid := 'f1b0ed78-0000-4000-8000-000000000004';
  v_goal_id uuid := 'f1b0ed78-0000-4000-8000-000000000005';
  v_order_id uuid := 'f1b0ed78-0000-4000-8000-000000000006';
  v_rejected boolean;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (v_merchant_id, 'finite-money@example.com', 'Finite Money', 'finite-money');
  INSERT INTO public.customers (id, merchant_id, email, first_name)
  VALUES (v_customer_id, v_merchant_id, 'customer@example.com', 'Customer');
  INSERT INTO public.products (id, merchant_id, name, price, status)
  VALUES (v_product_id, v_merchant_id, 'Finite device', 100, 'active');

  v_rejected := false;
  BEGIN
    INSERT INTO public.customer_savings_goals (
      merchant_id, customer_id, product_id, title, target_amount, current_amount,
      contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
      terms_accepted_at, non_withdrawable_accepted_at
    ) VALUES (
      v_merchant_id, v_customer_id, v_product_id, 'NaN target', 'NaN'::numeric, 0,
      10, 'daily', current_date, current_date, 'manual', now(), now()
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'NaN savings target unexpectedly succeeded';
  END IF;

  INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, price_override)
  VALUES (v_variant_id, v_product_id, v_merchant_id, '{}', 100);
  INSERT INTO public.customer_savings_goals (
    id, merchant_id, customer_id, product_id, variant_id, title, target_amount, current_amount,
    contribution_amount, contribution_frequency, start_date, maturity_date, source_mode, status,
    terms_accepted_at, non_withdrawable_accepted_at
  ) VALUES (
    v_goal_id, v_merchant_id, v_customer_id, v_product_id, v_variant_id, 'Finite redemption',
    100, 100, 10, 'daily', current_date, current_date, 'manual', 'completed', now(), now()
  );
  INSERT INTO public.orders (id, merchant_id, customer_id, order_number, total)
  VALUES (v_order_id, v_merchant_id, v_customer_id, 'finite-money-order', 100);
  INSERT INTO public.order_items (order_id, product_id, variant_id, name, price, quantity)
  VALUES (v_order_id, v_product_id, v_variant_id, 'Finite device', 100, 1);

  v_rejected := false;
  BEGIN
    INSERT INTO public.customer_savings_redemptions (
      goal_id, merchant_id, customer_id, order_id, amount, idempotency_key
    ) VALUES (
      v_goal_id, v_merchant_id, v_customer_id, v_order_id, 'NaN'::numeric, 'nan-redemption'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'NaN redemption unexpectedly succeeded';
  END IF;

  UPDATE public.orders
  SET total = 'NaN'::numeric
  WHERE id = v_order_id;

  v_rejected := false;
  BEGIN
    INSERT INTO public.customer_savings_redemptions (
      goal_id, merchant_id, customer_id, order_id, amount, idempotency_key
    ) VALUES (
      v_goal_id, v_merchant_id, v_customer_id, v_order_id, 100, 'nan-order-total'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'NaN order total unexpectedly accepted a redemption';
  END IF;

  UPDATE public.products
  SET price = 'NaN'::numeric
  WHERE id = v_product_id;

  v_rejected := false;
  BEGIN
    INSERT INTO public.customer_savings_goals (
      merchant_id, customer_id, product_id, title, target_amount, current_amount,
      contribution_amount, contribution_frequency, start_date, maturity_date, source_mode,
      terms_accepted_at, non_withdrawable_accepted_at
    ) VALUES (
      v_merchant_id, v_customer_id, v_product_id, 'NaN catalogue', 100, 0,
      10, 'daily', current_date, current_date, 'manual', now(), now()
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'NaN catalogue price unexpectedly succeeded';
  END IF;
END;
$$;

ROLLBACK;
