-- Customer-authorized loyalty status (issue #3165). The GET status route
-- cannot read customer_loyalty/points_transactions directly (merchant-only
-- RLS), so this RPC projects the caller's own enrollment, rewards, and
-- recent transactions after the same ownership check as enrollment.
-- Split from 20261009120000 (repository 300-line limit); applies right
-- after it. Exhausted finite rewards (stock_quantity = 0) are excluded so
-- the catalog never offers an unredeemable reward; NULL means unlimited.
CREATE OR REPLACE FUNCTION public.get_loyalty_status(
  p_merchant_id uuid,
  p_customer_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_settings record;
  v_loyalty record;
  v_enrolled boolean := false;
  v_rewards jsonb;
  v_transactions jsonb;
BEGIN
  IF p_merchant_id IS NULL OR p_customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_input');
  END IF;

  SELECT signup_bonus_points, referral_bonus_points,
         points_per_currency, points_currency_unit, tiers
  INTO v_settings
  FROM public.loyalty_settings
  WHERE merchant_id = p_merchant_id
    AND enabled IS TRUE;

  IF NOT FOUND THEN
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

  SELECT points_balance, lifetime_points, current_tier, referral_code
  INTO v_loyalty
  FROM public.customer_loyalty
  WHERE merchant_id = p_merchant_id
    AND customer_id = p_customer_id;

  v_enrolled := FOUND;

  SELECT COALESCE(jsonb_agg(reward ORDER BY (reward->>'points_cost')::integer), '[]'::jsonb)
  INTO v_rewards
  FROM (
    SELECT jsonb_build_object(
      'id', id,
      'name', name,
      'description', description,
      'points_cost', points_cost,
      'reward_type', reward_type,
      'reward_value', reward_value
    ) AS reward
    FROM public.loyalty_rewards
    WHERE merchant_id = p_merchant_id
      AND enabled IS TRUE
      AND (start_date IS NULL OR start_date <= pg_catalog.now())
      AND (end_date IS NULL OR end_date >= pg_catalog.now())
      AND (stock_quantity IS NULL OR stock_quantity > 0)
  ) AS rewards;

  SELECT COALESCE(jsonb_agg(txn ORDER BY txn->>'created_at' DESC), '[]'::jsonb)
  INTO v_transactions
  FROM (
    SELECT jsonb_build_object(
      'id', id,
      'points', points,
      'type', type,
      'description', description,
      'created_at', created_at
    ) AS txn
    FROM public.points_transactions
    WHERE merchant_id = p_merchant_id
      AND customer_id = p_customer_id
    ORDER BY created_at DESC
    LIMIT 10
  ) AS txns;

  IF NOT v_enrolled THEN
    RETURN jsonb_build_object(
      'success', true,
      'enrolled', false,
      'points_balance', 0,
      'lifetime_points', 0,
      'current_tier', 'Bronze',
      'referral_code', NULL,
      'tiers', COALESCE(v_settings.tiers, '[]'::jsonb),
      'signup_bonus_points', COALESCE(v_settings.signup_bonus_points, 0),
      'referral_bonus_points', COALESCE(v_settings.referral_bonus_points, 0),
      'points_per_currency', v_settings.points_per_currency,
      'points_currency_unit', v_settings.points_currency_unit,
      'rewards', v_rewards,
      'transactions', v_transactions
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'enrolled', true,
    'points_balance', COALESCE(v_loyalty.points_balance, 0),
    'lifetime_points', COALESCE(v_loyalty.lifetime_points, 0),
    'current_tier', COALESCE(v_loyalty.current_tier, 'Bronze'),
    'referral_code', v_loyalty.referral_code,
    'tiers', COALESCE(v_settings.tiers, '[]'::jsonb),
    'signup_bonus_points', COALESCE(v_settings.signup_bonus_points, 0),
    'referral_bonus_points', COALESCE(v_settings.referral_bonus_points, 0),
    'points_per_currency', v_settings.points_per_currency,
    'points_currency_unit', v_settings.points_currency_unit,
    'rewards', v_rewards,
    'transactions', v_transactions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_loyalty_status(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_loyalty_status(uuid, uuid)
  TO authenticated, service_role;
