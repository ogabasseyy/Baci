-- Goal-level idempotency for customer savings creation.
--
-- The mobile submission reuses `goalIdempotencyKey` after an ambiguous
-- failure, but the RPC ignored it: every retry inserted a second goal row
-- (the existing idempotency key only covers the initial contribution).
-- This migration stores the goal key at creation time and makes creation
-- idempotent per (merchant, customer, key):
-- - a fast-path replay lookup returns the existing goal before any product
--   checks, so replays succeed even if the catalogue changed since;
-- - the insert carries an ON CONFLICT DO NOTHING arbiter on the new unique
--   index so concurrent same-key creations collapse onto one row.
--
-- Safe replay shape: success=true with the existing goal id, current amount,
-- wallet balance, and status. contribution_id is NULL on replay (the initial
-- contribution id is only known at creation time).

ALTER TABLE public.customer_savings_goals
  ADD COLUMN IF NOT EXISTS goal_idempotency_key text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customer_savings_goals_goal_idempotency_key_uidx
  ON public.customer_savings_goals (merchant_id, customer_id, goal_idempotency_key)
  WHERE goal_idempotency_key IS NOT NULL;

DROP FUNCTION IF EXISTS public.create_customer_savings_goal(
  uuid, uuid, uuid, uuid, text, jsonb, numeric, numeric, numeric, text, time,
  date, date, text, uuid, timestamptz, timestamptz, timestamptz, timestamptz,
  numeric, jsonb, text
);

CREATE FUNCTION public.create_customer_savings_goal(
  p_customer_id uuid,
  p_merchant_id uuid,
  p_product_id uuid,
  p_variant_id uuid,
  p_title text,
  p_product_snapshot jsonb,
  p_target_amount numeric,
  p_initial_contribution_amount numeric,
  p_contribution_amount numeric,
  p_contribution_frequency text,
  p_preferred_debit_time time,
  p_start_date date,
  p_maturity_date date,
  p_source_mode text,
  p_saved_payment_method_id uuid,
  p_terms_accepted_at timestamptz,
  p_non_withdrawable_accepted_at timestamptz,
  p_auto_debit_authorized_at timestamptz,
  p_early_end_fee_accepted_at timestamptz,
  p_break_fee_percent numeric,
  p_metadata jsonb,
  p_initial_contribution_idempotency_key text,
  p_goal_idempotency_key text DEFAULT NULL
) RETURNS TABLE(
  success boolean,
  goal_id uuid,
  current_amount numeric,
  wallet_balance numeric,
  contribution_id uuid,
  goal_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_goal_id uuid;
  v_goal_status text := 'active';
  v_wallet_balance numeric := 0;
  v_current_amount numeric := 0;
  v_initial_contribution_id uuid;
  v_goal_idempotency_key text := NULLIF(TRIM(COALESCE(p_goal_idempotency_key, '')), '');
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'create_customer_savings_goal p_customer_id is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'create_customer_savings_goal p_merchant_id is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'create_customer_savings_goal p_product_id is required'
      USING ERRCODE = '22023';
  END IF;
  IF p_target_amount IS NULL OR p_target_amount <= 0 THEN
    RAISE EXCEPTION 'target_amount_must_be_positive'
      USING ERRCODE = '22023';
  END IF;
  IF p_contribution_amount IS NULL OR p_contribution_amount <= 0 THEN
    RAISE EXCEPTION 'contribution_amount_must_be_positive'
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_initial_contribution_amount, 0) < 0
    OR COALESCE(p_initial_contribution_amount, 0) > p_target_amount
  THEN
    RAISE EXCEPTION 'invalid_initial_contribution_amount'
      USING ERRCODE = '22023';
  END IF;
  IF p_contribution_frequency NOT IN ('daily', 'weekly', 'monthly') THEN
    RAISE EXCEPTION 'invalid_contribution_frequency'
      USING ERRCODE = '22023';
  END IF;
  IF p_source_mode NOT IN ('manual', 'auto_debit') THEN
    RAISE EXCEPTION 'invalid_savings_source_mode'
      USING ERRCODE = '22023';
  END IF;
  IF p_start_date IS NULL
    OR p_maturity_date IS NULL
    OR p_maturity_date < p_start_date
  THEN
    RAISE EXCEPTION 'invalid_savings_dates'
      USING ERRCODE = '22023';
  END IF;
  IF p_terms_accepted_at IS NULL OR p_non_withdrawable_accepted_at IS NULL THEN
    RAISE EXCEPTION 'required_savings_consents_missing'
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'authentication_required'
        USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = p_customer_id
        AND c.merchant_id = p_merchant_id
        AND c.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'not_authorized_for_customer_savings'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.id = p_customer_id
      AND c.merchant_id = p_merchant_id
  ) THEN
    RAISE EXCEPTION 'customer_not_found_for_merchant'
      USING ERRCODE = '42501';
  END IF;
  -- Idempotent replay: the same client key returns the existing goal even
  -- if the catalogue changed after the first creation. Runs after auth so
  -- key existence never leaks across customers.
  IF v_goal_idempotency_key IS NOT NULL THEN
    SELECT g.id, g.status, g.current_amount
      INTO v_goal_id, v_goal_status, v_current_amount
      FROM public.customer_savings_goals g
     WHERE g.merchant_id = p_merchant_id
       AND g.customer_id = p_customer_id
       AND g.goal_idempotency_key = v_goal_idempotency_key;

    IF FOUND THEN
      SELECT COALESCE(w.available_balance, 0)
        INTO v_wallet_balance
        FROM public.customer_wallets w
       WHERE w.merchant_id = p_merchant_id
         AND w.customer_id = p_customer_id;

      RETURN QUERY
      SELECT TRUE,
             v_goal_id,
             COALESCE(v_current_amount, 0::numeric),
             COALESCE(v_wallet_balance, 0::numeric),
             NULL::uuid,
             v_goal_status;
      RETURN;
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.merchant_id = p_merchant_id
      AND p.status = 'active'
  ) THEN
    RAISE EXCEPTION 'product_not_available_for_savings'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_variant_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.product_variants v
      WHERE v.id = p_variant_id
        AND v.product_id = p_product_id
        AND v.merchant_id = p_merchant_id
    )
  THEN
    RAISE EXCEPTION 'variant_not_available_for_savings'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_source_mode = 'auto_debit' THEN
    IF p_saved_payment_method_id IS NULL OR p_auto_debit_authorized_at IS NULL THEN
      RAISE EXCEPTION 'auto_debit_payment_method_and_consent_required'
        USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.customer_saved_payment_methods pm
      WHERE pm.id = p_saved_payment_method_id
        AND pm.customer_id = p_customer_id
        AND pm.merchant_id = p_merchant_id
        AND pm.provider = 'paystack'
        AND pm.is_active = true
        AND pm.reusable = true
    ) THEN
      RAISE EXCEPTION 'saved_payment_method_not_available_for_savings'
        USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(p_initial_contribution_amount, 0) > 0 THEN
      v_goal_status := 'paused';
    END IF;
  END IF;
  INSERT INTO public.customer_savings_goals (
    merchant_id,
    customer_id,
    product_id,
    variant_id,
    title,
    product_snapshot,
    target_amount,
    current_amount,
    initial_contribution_amount,
    contribution_amount,
    contribution_frequency,
    preferred_debit_time,
    start_date,
    maturity_date,
    source_mode,
    saved_payment_method_id,
    status,
    break_fee_percent,
    terms_accepted_at,
    non_withdrawable_accepted_at,
    auto_debit_authorized_at,
    early_end_fee_accepted_at,
    metadata,
    goal_idempotency_key
  )
  VALUES (
    p_merchant_id,
    p_customer_id,
    p_product_id,
    p_variant_id,
    p_title,
    COALESCE(p_product_snapshot, '{}'::jsonb),
    p_target_amount,
    0,
    COALESCE(p_initial_contribution_amount, 0),
    p_contribution_amount,
    p_contribution_frequency,
    p_preferred_debit_time,
    p_start_date,
    p_maturity_date,
    p_source_mode,
    p_saved_payment_method_id,
    v_goal_status,
    COALESCE(p_break_fee_percent, 0),
    p_terms_accepted_at,
    p_non_withdrawable_accepted_at,
    p_auto_debit_authorized_at,
    p_early_end_fee_accepted_at,
    COALESCE(p_metadata, '{}'::jsonb),
    v_goal_idempotency_key
  )
  ON CONFLICT (merchant_id, customer_id, goal_idempotency_key)
    WHERE goal_idempotency_key IS NOT NULL
    DO NOTHING
  RETURNING id INTO v_goal_id;
  -- Lost a creation race: another backend won with the same key. Return the
  -- winner instead of reporting success without a row.
  IF v_goal_id IS NULL AND v_goal_idempotency_key IS NOT NULL THEN
    SELECT g.id, g.status, g.current_amount
      INTO v_goal_id, v_goal_status, v_current_amount
      FROM public.customer_savings_goals g
     WHERE g.merchant_id = p_merchant_id
       AND g.customer_id = p_customer_id
       AND g.goal_idempotency_key = v_goal_idempotency_key;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'savings_goal_idempotency_winner_missing'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(w.available_balance, 0)
      INTO v_wallet_balance
      FROM public.customer_wallets w
     WHERE w.merchant_id = p_merchant_id
       AND w.customer_id = p_customer_id;

    RETURN QUERY
    SELECT TRUE,
           v_goal_id,
           COALESCE(v_current_amount, 0::numeric),
           COALESCE(v_wallet_balance, 0::numeric),
           NULL::uuid,
           v_goal_status;
    RETURN;
  END IF;
  INSERT INTO public.customer_savings_events (
    goal_id,
    merchant_id,
    customer_id,
    event_type,
    actor_type,
    metadata
  )
  VALUES (
    v_goal_id,
    p_merchant_id,
    p_customer_id,
    'goal_created',
    'customer',
    jsonb_build_object(
      'source_mode', p_source_mode,
      'target_amount', p_target_amount,
      'initial_contribution_amount', COALESCE(p_initial_contribution_amount, 0)
    )
  );
  IF p_source_mode = 'manual' AND COALESCE(p_initial_contribution_amount, 0) > 0 THEN
    SELECT
      allocation.goal_current_amount,
      allocation.wallet_balance,
      allocation.contribution_id,
      allocation.goal_status
    INTO
      v_current_amount,
      v_wallet_balance,
      v_initial_contribution_id,
      v_goal_status
    FROM public.allocate_customer_savings_contribution(
      v_goal_id,
      p_customer_id,
      p_merchant_id,
      p_initial_contribution_amount,
      'wallet',
      NULL,
      COALESCE(NULLIF(p_initial_contribution_idempotency_key, ''), 'savings:' || v_goal_id::text || ':initial'),
      'Initial device savings contribution'
    ) AS allocation;
  ELSE
    IF p_source_mode = 'auto_debit' AND COALESCE(p_initial_contribution_amount, 0) > 0 THEN
      INSERT INTO public.customer_savings_events (
        goal_id,
        merchant_id,
        customer_id,
        event_type,
        actor_type,
        metadata
      )
      VALUES (
        v_goal_id,
        p_merchant_id,
        p_customer_id,
        'initial_auto_debit_pending',
        'system',
        jsonb_build_object(
          'amount', p_initial_contribution_amount,
          'idempotency_key', COALESCE(NULLIF(p_initial_contribution_idempotency_key, ''), 'savings:' || v_goal_id::text || ':initial')
        )
      );
    END IF;

    SELECT COALESCE(w.available_balance, 0)
    INTO v_wallet_balance
    FROM public.customer_wallets w
    WHERE w.customer_id = p_customer_id
      AND w.merchant_id = p_merchant_id;
  END IF;
  RETURN QUERY
  SELECT
    true,
    v_goal_id,
    COALESCE(v_current_amount, 0::numeric),
    COALESCE(v_wallet_balance, 0::numeric),
    v_initial_contribution_id,
    v_goal_status;
END;
$$;
REVOKE ALL ON FUNCTION public.create_customer_savings_goal(
  uuid, uuid, uuid, uuid, text, jsonb, numeric, numeric, numeric, text, time,
  date, date, text, uuid, timestamptz, timestamptz, timestamptz, timestamptz,
  numeric, jsonb, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_customer_savings_goal(
  uuid, uuid, uuid, uuid, text, jsonb, numeric, numeric, numeric, text, time,
  date, date, text, uuid, timestamptz, timestamptz, timestamptz, timestamptz,
  numeric, jsonb, text, text
) TO authenticated, service_role;
