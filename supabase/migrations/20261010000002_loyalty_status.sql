-- Customer-authorized loyalty status (issue #3165). The GET status route
-- cannot read customer_loyalty/points_transactions directly (merchant-only
-- RLS), so this RPC projects the caller's own enrollment, rewards, and
-- recent transactions after the same ownership check as enrollment.
-- Split from 20261010000001 (repository 300-line limit); applies right
-- after it. Exhausted finite rewards (stock_quantity = 0) are excluded so
-- the catalog never offers an unredeemable reward; NULL means unlimited.
-- Rewards the caller already exhausted under usage_limit_per_customer are
-- excluded the same way, and the returned balance is the spendable
-- projection (materialized balance minus unreconciled expired lots), so
-- the storefront never advertises expired points or capped rewards.
--
-- The expiry math lives in calculate_unspent_expired_points below, shared
-- with the redemption RPC: FIFO lot accounting deducts only each expired
-- earning's unspent remainder instead of the gross earn sum.
CREATE OR REPLACE FUNCTION public.calculate_unspent_expired_points(
  p_merchant_id uuid,
  p_customer_id uuid
) RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH ledger AS (
    SELECT
      points_transactions.points,
      points_transactions.type,
      points_transactions.expires_at,
      points_transactions.expired,
      -- FIFO position: credits stacked before this row in ledger order.
      SUM(
        CASE WHEN points_transactions.points > 0
          THEN points_transactions.points
          ELSE 0
        END
      ) OVER (
        ORDER BY points_transactions.created_at, points_transactions.id
        ROWS UNBOUNDED PRECEDING
      ) - CASE WHEN points_transactions.points > 0
        THEN points_transactions.points
        ELSE 0
      END AS credits_before
    FROM public.points_transactions
    WHERE points_transactions.merchant_id = p_merchant_id
      AND points_transactions.customer_id = p_customer_id
  ),
  total_consumed AS (
    -- Every balance-reducing row consumes the oldest lots first. Prior
    -- expiry write-offs are included: each one consumed the remainder of
    -- the lots it wrote off, so excluding them would under-allocate
    -- consumption to already-settled lots and overstate the remainder.
    SELECT COALESCE(SUM(-ledger.points), 0) AS consumed
    FROM ledger
    WHERE ledger.points < 0
  )
  SELECT COALESCE(SUM(
    GREATEST(
      expired_lot.points
        - GREATEST(total_consumed.consumed - expired_lot.credits_before, 0),
      0
    )
  ), 0)::integer
  FROM ledger AS expired_lot
  CROSS JOIN total_consumed
  WHERE expired_lot.type = 'earn'
    AND expired_lot.expired IS DISTINCT FROM true
    AND expired_lot.expires_at IS NOT NULL
    AND expired_lot.expires_at < pg_catalog.now()
$$;

-- Helper with no ownership check: only the SECURITY DEFINER loyalty RPCs
-- may call it (definer's rights), never direct session callers.
REVOKE ALL ON FUNCTION public.calculate_unspent_expired_points(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_unspent_expired_points(uuid, uuid)
  TO service_role;

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
  v_spendable integer := 0;
  v_rewards jsonb;
  v_transactions jsonb;
BEGIN
  IF p_merchant_id IS NULL OR p_customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_input');
  END IF;

  SELECT signup_bonus_points, referral_bonus_points,
         points_per_currency, points_currency_unit, tiers,
         minimum_redemption_points
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

  -- Spendable projection: the materialized balance still holds expired
  -- lots until a redemption reconciles them, so project the same FIFO
  -- remainder the redemption RPC would deduct. Read-only: nothing is
  -- marked expired here.
  v_spendable := GREATEST(
    0,
    COALESCE(v_loyalty.points_balance, 0)
      - public.calculate_unspent_expired_points(p_merchant_id, p_customer_id)
  );

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
      -- Hide rewards this caller already exhausted: without this the
      -- post-redemption refetch re-advertises a capped reward (and the
      -- status card counts it redeemable) although every further redeem
      -- is rejected with usage_limit_reached.
      AND (usage_limit_per_customer IS NULL OR (
        SELECT COUNT(*)
        FROM public.reward_redemptions AS exhausted
        WHERE exhausted.merchant_id = p_merchant_id
          AND exhausted.customer_id = p_customer_id
          AND exhausted.reward_id = loyalty_rewards.id
      ) < usage_limit_per_customer)
      -- Hide rewards below the program minimum: redemption compares the
      -- cost (not the balance) against it, so an affordable-but-cheap
      -- reward would otherwise show enabled and always 400.
      AND (
        COALESCE(v_settings.minimum_redemption_points, 0) <= 0
        OR points_cost >= v_settings.minimum_redemption_points
      )
      -- Hide unsupported reward types (same allowlist as the redemption
      -- RPC; keep the two in sync): the catalog mapper folds unknowns
      -- into discount rendering, but redemption has no fulfillment for
      -- them and rejects every attempt.
      AND reward_type IN (
        'discount', 'discount_fixed', 'discount_percentage',
        'free_shipping', 'free_product', 'exclusive_access',
        'store_credit'
      )
      -- Hide valued rewards without a positive value (same predicate as
      -- the redemption RPC's valued guard; keep the two in sync): a
      -- null/zero/negative store_credit, discount_fixed, or
      -- discount_percentage always fails closed at redeem time, so
      -- advertising it only offers a permanently unredeemable reward.
      -- Plain 'discount' without a value stays listed: it is redeemable
      -- and renders a generic label.
      AND (
        reward_type NOT IN (
          'store_credit', 'discount_fixed', 'discount_percentage'
        )
        OR reward_value > 0
      )
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
    'points_balance', v_spendable,
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
