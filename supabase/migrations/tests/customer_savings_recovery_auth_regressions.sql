BEGIN;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := 'f2b0ed78-0000-4000-8000-000000000001';
  v_other_merchant_id uuid := 'f2b0ed78-0000-4000-8000-000000000002';
  v_owner_id uuid := 'f2b0ed78-0000-4000-8000-000000000003';
  v_other_user_id uuid := 'f2b0ed78-0000-4000-8000-000000000004';
  v_customer_id uuid := 'f2b0ed78-0000-4000-8000-000000000005';
  v_other_customer_id uuid := 'f2b0ed78-0000-4000-8000-000000000006';
  v_product_id uuid := 'f2b0ed78-0000-4000-8000-000000000007';
  v_variant_id uuid := 'f2b0ed78-0000-4000-8000-000000000008';
  v_owner_goal_id uuid := 'f2b0ed78-0000-4000-8000-000000000009';
  v_other_goal_id uuid := 'f2b0ed78-0000-4000-8000-000000000010';
  v_current_amount numeric;
  v_target_amount numeric;
  v_variant_after_rejection uuid;
  v_rejected boolean;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES
    (v_merchant_id, 'recovery-auth@example.com', 'Recovery Auth', 'recovery-auth'),
    (v_other_merchant_id, 'recovery-auth-other@example.com', 'Recovery Auth Other', 'recovery-auth-other');
  INSERT INTO public.customers (id, merchant_id, user_id, email, first_name)
  VALUES
    (v_customer_id, v_merchant_id, v_owner_id, 'owner@example.com', 'Owner'),
    (v_other_customer_id, v_merchant_id, v_other_user_id, 'other@example.com', 'Other');
  INSERT INTO public.products (id, merchant_id, name, price, status)
  VALUES (v_product_id, v_merchant_id, 'Recovery device', 90, 'active');
  INSERT INTO public.customer_savings_goals (
    id, merchant_id, customer_id, product_id, title, product_snapshot, target_amount,
    current_amount, contribution_amount, contribution_frequency, start_date, maturity_date,
    source_mode, status, completed_at, terms_accepted_at, non_withdrawable_accepted_at
  ) VALUES
    (v_owner_goal_id, v_merchant_id, v_customer_id, v_product_id, 'Owner recovery',
      '{"price":90,"cataloguePrice":90}'::jsonb, 90, 90, 10, 'daily', current_date,
      current_date, 'manual', 'completed', now(), now(), now()),
    (v_other_goal_id, v_merchant_id, v_customer_id, v_product_id, 'Rejected recovery',
      '{"price":90,"cataloguePrice":90}'::jsonb, 90, 90, 10, 'daily', current_date,
      current_date, 'manual', 'completed', now(), now(), now());
  INSERT INTO public.product_variants (id, product_id, merchant_id, attributes, price_override)
  VALUES (v_variant_id, v_product_id, v_merchant_id, '{}', 90);

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM 1 FROM public.resolve_completed_customer_savings_goal_variant(
    v_owner_goal_id, v_customer_id, v_merchant_id, v_owner_id, v_variant_id
  );
  SET LOCAL ROLE service_role;
  SELECT g.current_amount, g.target_amount INTO v_current_amount, v_target_amount
  FROM public.customer_savings_goals AS g WHERE g.id = v_owner_goal_id;
  IF v_current_amount IS DISTINCT FROM 90 OR v_target_amount IS DISTINCT FROM 90 THEN
    RAISE EXCEPTION 'owner recovery changed the locked balance or target';
  END IF;
  SET LOCAL ROLE authenticated;

  v_rejected := false;
  PERFORM set_config('request.jwt.claim.sub', v_other_user_id::text, true);
  BEGIN
    PERFORM 1 FROM public.resolve_completed_customer_savings_goal_variant(
      v_other_goal_id, v_customer_id, v_merchant_id, v_owner_id, v_variant_id
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'wrong auth.uid recovered a goal'; END IF;

  v_rejected := false;
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, true);
  BEGIN
    PERFORM 1 FROM public.resolve_completed_customer_savings_goal_variant(
      v_other_goal_id, v_other_customer_id, v_merchant_id, v_owner_id, v_variant_id
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'wrong customer recovered a goal'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM 1 FROM public.resolve_completed_customer_savings_goal_variant(
      v_other_goal_id, v_customer_id, v_other_merchant_id, v_owner_id, v_variant_id
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'wrong merchant recovered a goal'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM 1 FROM public.resolve_completed_customer_savings_goal_variant(
      v_other_goal_id, v_customer_id, v_merchant_id, v_other_user_id, v_variant_id
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'wrong actor recovered a goal'; END IF;

  v_rejected := false;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  BEGIN
    PERFORM 1 FROM public.resolve_completed_customer_savings_goal_variant(
      v_other_goal_id, v_customer_id, v_merchant_id, v_owner_id, v_variant_id
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'unauthenticated recovery succeeded'; END IF;

  SET LOCAL ROLE service_role;
  SELECT g.variant_id, g.current_amount, g.target_amount
  INTO v_variant_after_rejection, v_current_amount, v_target_amount
  FROM public.customer_savings_goals AS g WHERE g.id = v_other_goal_id;
  IF v_variant_after_rejection IS NOT NULL
    OR v_current_amount IS DISTINCT FROM 90
    OR v_target_amount IS DISTINCT FROM 90
  THEN
    RAISE EXCEPTION 'rejected recovery changed locked goal state';
  END IF;
END;
$$;

ROLLBACK;
