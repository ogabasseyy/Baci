-- =============================================
-- REGRESSION TEST: create_customer_savings_goal fresh idempotency key
--   Before 20261105190000 the replay lookup's SELECT ... INTO nulled
--   v_goal_status on a miss, so every first-time creation failed with a
--   NOT NULL violation (23502) on customer_savings_goals.status.
--   Validates: fresh key creates an 'active' goal, a repeat with the same key
--   and fingerprint returns the same goal (no second row), and creation
--   without any key also yields 'active'.
--
-- USAGE:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/tests/savings_goal_create_null_status.sql
-- =============================================

BEGIN;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_merchant_id uuid := '8f0ed783-0000-4000-8000-000000000601';
  v_customer_id uuid := '8f0ed783-0000-4000-8000-000000000602';
  v_product_id uuid := '8f0ed783-0000-4000-8000-000000000603';
  v_first record;
  v_replay record;
  v_nokey record;
  v_status text;
  v_goal_count integer;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (v_merchant_id, 'savings-null-status@example.com', 'Savings Null Status Store', 'savings-null-status-store');

  INSERT INTO public.customers (id, merchant_id, email, first_name)
  VALUES (v_customer_id, v_merchant_id, 'savings-null-status-customer@example.com', 'Savings');

  INSERT INTO public.products (id, merchant_id, name, price, status, stock_quantity)
  VALUES (v_product_id, v_merchant_id, 'Null status savings test', 800000, 'active', 3);

  -- Fresh key, zero initial contribution (no wallet needed).
  SELECT * INTO v_first
  FROM public.create_customer_savings_goal(
    v_customer_id, v_merchant_id, v_product_id, NULL,
    'Null status savings test',
    '{"name":"Null status savings test","price":800000}'::jsonb,
    800000, 0, 20000, 'daily', '06:20'::time,
    current_date, current_date + 30, 'manual', NULL,
    now(), now(), NULL, NULL, 0,
    '{"test":"fresh-key"}'::jsonb,
    NULL,
    'goal-key-fresh-1',
    'fingerprint-1'
  );

  IF v_first.success IS DISTINCT FROM true OR v_first.goal_id IS NULL THEN
    RAISE EXCEPTION 'fresh-key create did not succeed: %', row_to_json(v_first);
  END IF;
  IF v_first.goal_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'fresh-key create must return active, got %', v_first.goal_status;
  END IF;

  SELECT status INTO v_status
  FROM public.customer_savings_goals
  WHERE id = v_first.goal_id;
  IF v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'stored goal status must be active, got %', v_status;
  END IF;

  -- Same key and fingerprint: idempotent replay returns the same goal.
  SELECT * INTO v_replay
  FROM public.create_customer_savings_goal(
    v_customer_id, v_merchant_id, v_product_id, NULL,
    'Null status savings test',
    '{"name":"Null status savings test","price":800000}'::jsonb,
    800000, 0, 20000, 'daily', '06:20'::time,
    current_date, current_date + 30, 'manual', NULL,
    now(), now(), NULL, NULL, 0,
    '{"test":"fresh-key"}'::jsonb,
    NULL,
    'goal-key-fresh-1',
    'fingerprint-1'
  );

  IF v_replay.success IS DISTINCT FROM true
    OR v_replay.goal_id IS DISTINCT FROM v_first.goal_id
    OR v_replay.goal_status IS DISTINCT FROM 'active'
  THEN
    RAISE EXCEPTION 'replay must return the same active goal: first %, replay %',
      row_to_json(v_first), row_to_json(v_replay);
  END IF;

  SELECT count(*) INTO v_goal_count
  FROM public.customer_savings_goals
  WHERE merchant_id = v_merchant_id
    AND customer_id = v_customer_id
    AND goal_idempotency_key = 'goal-key-fresh-1';
  IF v_goal_count <> 1 THEN
    RAISE EXCEPTION 'replay must not insert a second goal, found %', v_goal_count;
  END IF;

  -- No idempotency key at all: the lookup is skipped and status stays active.
  SELECT * INTO v_nokey
  FROM public.create_customer_savings_goal(
    v_customer_id, v_merchant_id, v_product_id, NULL,
    'Null status savings test no key',
    '{"name":"Null status savings test","price":800000}'::jsonb,
    800000, 0, 20000, 'daily', '06:20'::time,
    current_date, current_date + 30, 'manual', NULL,
    now(), now(), NULL, NULL, 0,
    '{"test":"no-key"}'::jsonb,
    NULL
  );
  IF v_nokey.success IS DISTINCT FROM true
    OR v_nokey.goal_status IS DISTINCT FROM 'active'
    OR v_nokey.goal_id IS NOT DISTINCT FROM v_first.goal_id
  THEN
    RAISE EXCEPTION 'no-key create must create a separate active goal: %', row_to_json(v_nokey);
  END IF;
END;
$$;

ROLLBACK;
