-- Atomic customer-authorized reward redemption (issue #3165).
--
-- POST /api/storefront/loyalty/redeem was written against columns that do
-- not exist (loyalty_rewards.discount_value / discount_type /
-- points_required / min_tier / active, customer_loyalty.tier,
-- reward_redemptions.status, points_transactions.reference_id), had no
-- ownership check, and cannot touch the merchant-only RLS tables with a
-- customer session anyway — so every redemption 404'd or 500'd while the
-- status route advertises redeemable rewards.
--
-- This SECURITY DEFINER RPC performs the whole redemption in one
-- transaction against the real schema (baseline 20260418000000):
-- availability (enabled, dates, finite stock with atomic decrement),
-- balance check, redemption insert, points deduction, and ledger row.
-- The caller must own the customer row (customers.user_id = auth.uid()).
CREATE OR REPLACE FUNCTION public.redeem_loyalty_reward(
  p_merchant_id uuid,
  p_customer_id uuid,
  p_reward_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_enabled boolean := false;
  v_loyalty_id uuid;
  v_balance integer := 0;
  v_reward record;
  v_new_balance integer := 0;
  v_redemption_id uuid;
  v_redemption_code text;
  v_expires_at timestamptz;
BEGIN
  IF p_merchant_id IS NULL OR p_customer_id IS NULL OR p_reward_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_input');
  END IF;

  SELECT enabled INTO v_enabled
  FROM public.loyalty_settings
  WHERE merchant_id = p_merchant_id;

  IF NOT FOUND OR v_enabled IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success', false, 'error', 'program_unavailable');
  END IF;

  -- Existence, liveness, and ownership in one predicate (see enrollment).
  PERFORM 1
  FROM public.customers
  WHERE id = p_customer_id
    AND merchant_id = p_merchant_id
    AND deleted_at IS NULL
    AND user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'customer_not_found');
  END IF;

  -- Lock the member row: concurrent redemptions must serialize on the
  -- balance check below instead of double-spending.
  SELECT id, COALESCE(points_balance, 0)
  INTO v_loyalty_id, v_balance
  FROM public.customer_loyalty
  WHERE merchant_id = p_merchant_id
    AND customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_enrolled');
  END IF;

  -- Lock the reward row: finite stock decrements atomically below.
  SELECT id, name, reward_type, reward_value, points_cost, stock_quantity
  INTO v_reward
  FROM public.loyalty_rewards
  WHERE id = p_reward_id
    AND merchant_id = p_merchant_id
    AND enabled IS TRUE
    AND (start_date IS NULL OR start_date <= pg_catalog.now())
    AND (end_date IS NULL OR end_date >= pg_catalog.now())
    AND (stock_quantity IS NULL OR stock_quantity > 0)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'reward_unavailable');
  END IF;

  IF v_balance < v_reward.points_cost THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'insufficient_points',
      'required', v_reward.points_cost,
      'available', v_balance
    );
  END IF;

  v_new_balance := v_balance - v_reward.points_cost;
  v_redemption_code := 'RDM-' || pg_catalog.upper(pg_catalog.substring(pg_catalog.md5(pg_catalog.random()::text || pg_catalog.clock_timestamp()::text), 1, 12));
  v_expires_at := pg_catalog.now() + interval '30 days';

  IF v_reward.stock_quantity IS NOT NULL THEN
    UPDATE public.loyalty_rewards
    SET stock_quantity = stock_quantity - 1,
        updated_at = pg_catalog.now()
    WHERE id = p_reward_id;
  END IF;

  INSERT INTO public.reward_redemptions (
    merchant_id, customer_id, reward_id, points_spent,
    reward_type, reward_value, discount_code, expires_at
  ) VALUES (
    p_merchant_id, p_customer_id, p_reward_id, v_reward.points_cost,
    v_reward.reward_type, v_reward.reward_value, v_redemption_code, v_expires_at
  )
  RETURNING id INTO v_redemption_id;

  UPDATE public.customer_loyalty
  SET points_balance = v_new_balance,
      updated_at = pg_catalog.now()
  WHERE id = v_loyalty_id;

  INSERT INTO public.points_transactions (
    customer_id, merchant_id, type, points, balance_after,
    source, source_id, description
  ) VALUES (
    p_customer_id, p_merchant_id, 'redemption', -v_reward.points_cost, v_new_balance,
    'redemption', v_redemption_id::text, 'Redeemed: ' || v_reward.name
  );

  RETURN jsonb_build_object(
    'success', true,
    'redemption_code', v_redemption_code,
    'reward_name', v_reward.name,
    'reward_type', v_reward.reward_type,
    'reward_value', v_reward.reward_value,
    'points_spent', v_reward.points_cost,
    'new_balance', v_new_balance,
    'expires_at', v_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_loyalty_reward(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_loyalty_reward(uuid, uuid, uuid)
  TO authenticated, service_role;
