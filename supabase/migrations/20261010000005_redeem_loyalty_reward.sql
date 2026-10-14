-- Atomic customer-authorized reward redemption (issue #3165).
-- SECURITY DEFINER; caller owns the row; no 3-arg arity.
DROP FUNCTION IF EXISTS public.redeem_loyalty_reward(uuid, uuid, uuid);
CREATE OR REPLACE FUNCTION public.redeem_loyalty_reward(
  p_merchant_id uuid,
  p_customer_id uuid,
  p_reward_id uuid,
  p_idempotency_key uuid DEFAULT NULL
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
  v_attempt integer := 0;
  v_redemption_id uuid;
  v_redemption_code text;
  v_currency text;
  v_max_redemption_pct numeric;
  v_expires_at timestamptz;
  v_expired_points integer := 0;
  v_redemption_count integer := 0;
  v_replay jsonb := NULL;
  v_response jsonb := NULL;
BEGIN
  IF p_merchant_id IS NULL OR p_customer_id IS NULL OR p_reward_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_input');
  END IF;
  -- Existence/liveness/ownership first (replay would leak the code).
  PERFORM 1
  FROM public.customers
  WHERE id = p_customer_id
    AND merchant_id = p_merchant_id
    AND deleted_at IS NULL
    AND user_id = auth.uid();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'customer_not_found');
  END IF;
  -- Idempotency replay runs before the program gate.
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('loyalty_redeem:' || p_idempotency_key::text)
    );
    v_replay := public.get_loyalty_redemption_idempotency(
      p_idempotency_key, p_merchant_id, p_customer_id, p_reward_id
    );
    IF v_replay IS NOT NULL THEN
      RETURN v_replay;
    END IF;
  END IF;
  -- FOR SHARE pins program state through settlement without
  -- serializing concurrent redemptions on the settings row.

  SELECT enabled, minimum_redemption_points, maximum_redemption_percentage
  INTO v_enabled, v_minimum, v_max_redemption_pct
  FROM public.loyalty_settings
  WHERE merchant_id = p_merchant_id
  FOR SHARE;
  IF NOT FOUND OR v_enabled IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('success', false, 'error', 'program_unavailable');
  END IF;
  -- (The cap is validated after the reward loads, scoped to checkout
  -- discount types: an invalid legacy cap must not make every other
  -- reward type unredeemable.)
  -- Lock the member row (redemptions serialize on balance).
  SELECT id, COALESCE(points_balance, 0)
  INTO v_loyalty_id, v_balance
  FROM public.customer_loyalty
  WHERE merchant_id = p_merchant_id
    AND customer_id = p_customer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_enrolled');
  END IF;
  -- Reconcile expired purchase credits first.
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
  -- Lock the reward row.
  SELECT id, name, reward_type, reward_value, points_cost, stock_quantity,
         usage_limit_per_customer, minimum_order_amount, reward_product_id
  INTO v_reward
  FROM public.loyalty_rewards
  WHERE id = p_reward_id
    AND merchant_id = p_merchant_id
    AND enabled IS TRUE
    AND (start_date IS NULL OR start_date <= pg_catalog.now())
    AND (end_date IS NULL OR end_date >= pg_catalog.now())
    AND (stock_quantity IS NULL OR stock_quantity > 0)
    -- Non-positive costs would mint points: fail closed (mirrored in status).
    AND points_cost > 0
    -- Reject types with no fulfillment path before any mutation (same
    -- allowlist as status; keep in sync). Manual-fulfillment types
    -- mint a present-the-code redemption; checkout never honors them.
    AND reward_type IN (
      'discount', 'discount_fixed', 'discount_percentage',
      'store_credit', 'free_shipping', 'free_product',
      'exclusive_access'
    )
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'reward_unavailable');
  END IF;
  -- Usage cap counts purchases, not checkout uses.
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
  -- Program minimum compares cost, not balance.
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
  -- A non-positive/over-100 cap mints a worthless CHECKOUT code:
  -- refuse for checkout-bound discounts only. Manual/wallet rewards
  -- never read the cap, and a valueless plain discount is manual
  -- fulfillment (present-the-code), not a checkout discount.
  IF v_max_redemption_pct IS NOT NULL
     AND (v_max_redemption_pct <= 0 OR v_max_redemption_pct > 100)
     AND (v_reward.reward_type IN ('discount_fixed', 'discount_percentage')
       OR (v_reward.reward_type = 'discount'
         AND COALESCE(v_reward.reward_value, 0) > 0)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'reward_unavailable');
  END IF;
  -- Valued rewards need positive value (<=100%).
  IF v_reward.reward_type IN (
       'store_credit', 'discount_fixed', 'discount_percentage'
     )
     AND (v_reward.reward_value IS NULL OR v_reward.reward_value <= 0
       OR v_reward.reward_type = 'discount_percentage' AND v_reward.reward_value > 100) THEN
    RETURN jsonb_build_object('success', false, 'error', 'reward_unavailable');
  END IF;
  -- Minimum-gated store credit and manual-fulfillment rewards fail
  -- closed: neither has an order amount to enforce the minimum against
  -- (checkout for store credit, the consume endpoint for manual types).
  IF v_reward.minimum_order_amount IS NOT NULL
     AND v_reward.minimum_order_amount > 0
     AND (v_reward.reward_type = 'store_credit'
       OR v_reward.reward_type IN (
         'free_shipping', 'free_product', 'exclusive_access')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'reward_unavailable');
  END IF;
  -- Fixed values rounding to zero units: reject before deduction.
  IF v_reward.reward_type IN ('discount', 'discount_fixed')
     AND v_reward.reward_value IS NOT NULL
     AND pg_catalog.round(v_reward.reward_value, 0) <= 0 THEN
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
  v_expires_at := pg_catalog.now() + interval '30 days';
  -- Lock the merchant row before resolving currency for every
  -- currency-bound reward (no born-mismatched code).
  IF v_reward.reward_type IN ('discount', 'discount_fixed', 'store_credit')
     OR COALESCE(v_reward.minimum_order_amount, 0) > 0 THEN
    PERFORM 1 FROM public.merchants WHERE id = p_merchant_id FOR UPDATE;
  END IF;
  IF v_reward.reward_type = 'store_credit'
     AND NOT public.merchant_resolves_to_ngn(p_merchant_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'reward_unavailable');
  END IF;
  -- Mint a merchant-unique code; stamp currency + cap.
  v_currency := public.merchant_resolved_currency(p_merchant_id);
  LOOP
    v_attempt := v_attempt + 1;
    v_redemption_code := 'RDM-' || pg_catalog.upper(pg_catalog.substring(pg_catalog.md5(pg_catalog.random()::text || pg_catalog.clock_timestamp()::text), 1, 12));
    IF NOT EXISTS (
      SELECT 1 FROM public.reward_redemptions
      WHERE merchant_id = p_merchant_id
        AND pg_catalog.upper(discount_code) = v_redemption_code
    ) AND NOT EXISTS (
      SELECT 1 FROM public.discount_codes
      WHERE merchant_id = p_merchant_id
        AND pg_catalog.upper(code) = v_redemption_code
    ) THEN
      BEGIN
        INSERT INTO public.reward_redemptions (
          merchant_id, customer_id, reward_id, points_spent,
          reward_type, reward_value, discount_code, expires_at,
          minimum_order_amount, issuance_currency, max_redemption_percentage,
          reward_name, reward_product_id
        ) VALUES (
          p_merchant_id, p_customer_id, p_reward_id, v_reward.points_cost,
          v_reward.reward_type, v_reward.reward_value, v_redemption_code, v_expires_at,
          COALESCE(v_reward.minimum_order_amount, 0), v_currency,
          v_max_redemption_pct, v_reward.name, v_reward.reward_product_id
        )
        RETURNING id INTO v_redemption_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- Concurrent mint collision on the code index: mint again below.
      END;
    END IF;
    IF v_attempt >= 5 THEN
      RETURN jsonb_build_object('success', false, 'error', 'redemption_code_collision');
    END IF;
  END LOOP;
  -- Stock decrements only after the insert.
  IF v_reward.stock_quantity IS NOT NULL THEN
    UPDATE public.loyalty_rewards
    SET stock_quantity = stock_quantity - 1,
        updated_at = pg_catalog.now()
    WHERE id = p_reward_id;
  END IF;

  -- store_credit fulfillment: credit the wallet ledger checkout spends.
  IF v_reward.reward_type = 'store_credit' THEN
    PERFORM public.credit_customer_wallet(
      p_customer_id, p_merchant_id, v_reward.reward_value,
      'loyalty_redemption', v_redemption_id,
      'Loyalty reward: ' || v_reward.name
    );
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

  v_response := jsonb_build_object(
    'success', true,
    'redemption_code', v_redemption_code,
    'reward_name', v_reward.name,
    'reward_type', v_reward.reward_type,
    'reward_value', v_reward.reward_value,
    'issuance_currency', v_currency,
    'max_redemption_percentage', v_max_redemption_pct,
    'points_spent', v_reward.points_cost,
    'new_balance', v_new_balance,
    'expires_at', v_expires_at
  );
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM public.store_loyalty_redemption_idempotency(
      p_idempotency_key, p_merchant_id, p_customer_id, p_reward_id,
      v_response
    );
  END IF;
  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_loyalty_reward(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_loyalty_reward(uuid, uuid, uuid, uuid)
  TO authenticated, service_role;
