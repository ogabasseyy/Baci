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
-- expiry reconciliation, availability (enabled, dates, finite stock with
-- atomic decrement, supported reward types), per-customer usage cap,
-- program minimum redemption amount, valued-reward guard, store_credit
-- fulfillment, balance check, redemption insert, points deduction, and
-- ledger row.
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
  v_minimum integer := NULL;
  v_loyalty_id uuid;
  v_balance integer := 0;
  v_reward record;
  v_new_balance integer := 0;
  v_redemption_id uuid;
  v_redemption_code text;
  v_expires_at timestamptz;
  v_expired_points integer := 0;
  v_redemption_count integer := 0;
BEGIN
  IF p_merchant_id IS NULL OR p_customer_id IS NULL OR p_reward_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_input');
  END IF;

  SELECT enabled, minimum_redemption_points INTO v_enabled, v_minimum
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

  -- Reconcile expired purchase credits before the balance check: award
  -- stamps expires_at on earn transactions but nothing ever subtracts
  -- them, so without this expired points stay spendable forever. Only
  -- each expired lot's unspent remainder is deducted (FIFO: spends
  -- consume the oldest lots first), so partly-spent lots and newer
  -- permanent points survive. The member-row lock above serializes
  -- concurrent redemptions, so a second redeem sees expired = true
  -- already committed and cannot double-count.
  v_expired_points := public.calculate_unspent_expired_points(
    p_merchant_id, p_customer_id
  );

  IF v_expired_points > 0 THEN
    UPDATE public.points_transactions
    SET expired = true
    WHERE merchant_id = p_merchant_id
      AND customer_id = p_customer_id
      AND type = 'earn'
      AND expired IS DISTINCT FROM true
      AND expires_at IS NOT NULL
      AND expires_at < pg_catalog.now();

    v_balance := GREATEST(0, v_balance - v_expired_points);
    UPDATE public.customer_loyalty
    SET points_balance = v_balance,
        updated_at = pg_catalog.now()
    WHERE id = v_loyalty_id;
    INSERT INTO public.points_transactions (
      customer_id, merchant_id, type, points, balance_after,
      source, description
    ) VALUES (
      p_customer_id, p_merchant_id, 'expiry', -v_expired_points, v_balance,
      'expiry', 'Expired purchase points reconciled'
    );
  END IF;

  -- Lock the reward row: finite stock decrements atomically below.
  SELECT id, name, reward_type, reward_value, points_cost, stock_quantity,
         usage_limit_per_customer
  INTO v_reward
  FROM public.loyalty_rewards
  WHERE id = p_reward_id
    AND merchant_id = p_merchant_id
    AND enabled IS TRUE
    AND (start_date IS NULL OR start_date <= pg_catalog.now())
    AND (end_date IS NULL OR end_date >= pg_catalog.now())
    AND (stock_quantity IS NULL OR stock_quantity > 0)
    -- Reject unsupported reward types before any mutation (same
    -- allowlist as the status RPC; keep the two in sync): the merchant
    -- PATCH endpoint stores reward_type without an allowlist, and this
    -- RPC has no fulfillment behavior for unknown types, so redeeming
    -- one would burn stock and points for a meaningless code.
    AND reward_type IN (
      'discount', 'discount_fixed', 'discount_percentage',
      'free_shipping', 'free_product', 'exclusive_access',
      'store_credit'
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'reward_unavailable');
  END IF;

  -- Per-customer usage cap: without this a limit-1 reward is redeemable
  -- repeatedly and only global stock bounds it. Every row counts,
  -- including codes that expire unused: points are deducted at redeem
  -- time with no refund-on-expiry flow, so the cap counts purchases,
  -- not checkout uses.
  IF v_reward.usage_limit_per_customer IS NOT NULL THEN
    SELECT COUNT(*) INTO v_redemption_count
    FROM public.reward_redemptions
    WHERE merchant_id = p_merchant_id
      AND customer_id = p_customer_id
      AND reward_id = p_reward_id;
    IF v_redemption_count >= v_reward.usage_limit_per_customer THEN
      RETURN jsonb_build_object('success', false, 'error', 'usage_limit_reached');
    END IF;
  END IF;

  -- Program minimum: the dashboard's "Minimum Redemption Points" is the
  -- smallest single redemption the merchant allows (a 100-point reward
  -- cannot be redeemed when the minimum is 500, even with a 600-point
  -- balance). Matches the sibling redeem_loyalty_points / redeem_points
  -- contracts, which compare the requested amount, not the balance.
  IF v_minimum IS NOT NULL AND v_minimum > 0
     AND v_reward.points_cost < v_minimum THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'minimum_not_met',
      'required', v_minimum,
      'available', v_balance,
      'points_cost', v_reward.points_cost
    );
  END IF;

  -- Valued rewards must carry a positive value: store_credit credits the
  -- customer balance below, and discount_fixed / discount_percentage
  -- redemptions advertise the value at checkout, so a missing or
  -- non-positive value is a misconfigured reward, failed closed here
  -- before any write (stock, redemption, deduction). Plain 'discount'
  -- rewards without a value stay redeemable: the catalog renders them
  -- with a zero label and the suite pins that behavior.
  IF v_reward.reward_type IN (
       'store_credit', 'discount_fixed', 'discount_percentage'
     )
     AND (v_reward.reward_value IS NULL OR v_reward.reward_value <= 0) THEN
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

  -- store_credit fulfillment: credit the spendable customer balance in
  -- the same transaction (row locked: concurrent credits serialize).
  -- Without this the customer loses points for a useless discount code.
  IF v_reward.reward_type = 'store_credit' THEN
    UPDATE public.customers
    SET store_credit = COALESCE(store_credit, 0) + v_reward.reward_value,
        updated_at = pg_catalog.now()
    WHERE id = p_customer_id;
  END IF;

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
