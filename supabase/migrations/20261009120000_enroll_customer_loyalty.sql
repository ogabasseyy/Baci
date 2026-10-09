-- Atomic loyalty enrollment (issue #3165).
--
-- POST /api/storefront/loyalty/enroll was written against columns that do not
-- exist (loyalty_settings.welcome_bonus / referral_bonus_referee /
-- referral_bonus_referrer, customer_loyalty.tier / referred_by) and called a
-- non-existent increment_loyalty_points RPC, so it 500'd on the first SELECT
-- while the UI advertised signup/referral bonus points.
--
-- This SECURITY DEFINER RPC performs the whole enrollment in one transaction
-- against the real schema (baseline 20260418000000):
--   loyalty_settings(signup_bonus_points, referral_bonus_points)
--   customer_loyalty(current_tier, referred_by_customer_id)
--   points_transactions(... balance_after NOT NULL, source NOT NULL)
--
-- Product decision (issue #3165, option a): the single referral_bonus_points
-- value is awarded to BOTH the referrer and the referee ("you both get X").

CREATE OR REPLACE FUNCTION public.enroll_customer_loyalty(
  p_merchant_id uuid,
  p_customer_id uuid,
  p_referral_code text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_signup_bonus integer := 0;
  v_referral_bonus integer := 0;
  v_referrer_customer_id uuid := NULL;
  v_referrer_balance integer := 0;
  v_initial_points integer := 0;
  v_loyalty_id uuid;
  v_referral_code text;
  v_attempt integer := 0;
BEGIN
  IF p_merchant_id IS NULL OR p_customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_input');
  END IF;

  -- Fail closed when the program is missing or disabled. Clamp negative
  -- merchant config to zero so balances can never go negative.
  SELECT
    GREATEST(COALESCE(signup_bonus_points, 0), 0),
    GREATEST(COALESCE(referral_bonus_points, 0), 0)
  INTO v_signup_bonus, v_referral_bonus
  FROM public.loyalty_settings
  WHERE merchant_id = p_merchant_id
    AND enabled IS TRUE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'program_unavailable');
  END IF;

  -- The customer must exist and belong to this merchant.
  PERFORM 1
  FROM public.customers
  WHERE id = p_customer_id
    AND merchant_id = p_merchant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'customer_not_found');
  END IF;

  -- Reject double enrollment (also enforced by the UNIQUE insert below).
  PERFORM 1
  FROM public.customer_loyalty
  WHERE merchant_id = p_merchant_id
    AND customer_id = p_customer_id;

  IF FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_enrolled');
  END IF;

  -- Resolve the referrer. Unknown or self-referral codes are ignored so a bad
  -- code never blocks enrollment (matches previous route behavior).
  IF p_referral_code IS NOT NULL AND pg_catalog.btrim(p_referral_code) <> '' THEN
    SELECT referrer.customer_id, referrer.points_balance
    INTO v_referrer_customer_id, v_referrer_balance
    FROM public.customer_loyalty AS referrer
    WHERE referrer.merchant_id = p_merchant_id
      AND pg_catalog.upper(referrer.referral_code)
        = pg_catalog.upper(pg_catalog.btrim(p_referral_code))
    FOR UPDATE;

    IF v_referrer_customer_id IS NOT DISTINCT FROM p_customer_id THEN
      v_referrer_customer_id := NULL;
    END IF;
    v_referrer_balance := COALESCE(v_referrer_balance, 0);
  END IF;

  IF v_referrer_customer_id IS NOT NULL THEN
    v_initial_points := v_signup_bonus + v_referral_bonus;
  ELSE
    v_initial_points := v_signup_bonus;
  END IF;

  -- Mint a referral code for the new member (bounded uniqueness probe).
  LOOP
    v_attempt := v_attempt + 1;
    v_referral_code := pg_catalog.upper(
      pg_catalog.substring(
        pg_catalog.md5(pg_catalog.random()::text || pg_catalog.clock_timestamp()::text),
        1,
        8
      )
    );
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.customer_loyalty
      WHERE merchant_id = p_merchant_id
        AND referral_code = v_referral_code
    );
    IF v_attempt >= 5 THEN
      RETURN jsonb_build_object('success', false, 'error', 'referral_code_collision');
    END IF;
  END LOOP;

  BEGIN
    INSERT INTO public.customer_loyalty (
      merchant_id, customer_id, points_balance, lifetime_points,
      current_tier, referral_code, referred_by_customer_id
    ) VALUES (
      p_merchant_id, p_customer_id, v_initial_points, v_initial_points,
      'Bronze', v_referral_code, v_referrer_customer_id
    )
    RETURNING id INTO v_loyalty_id;
  EXCEPTION WHEN unique_violation THEN
    -- Lost a concurrent-enrollment race on UNIQUE (customer_id, merchant_id).
    RETURN jsonb_build_object('success', false, 'error', 'already_enrolled');
  END;

  -- Signup bonus ledger row.
  IF v_signup_bonus > 0 THEN
    INSERT INTO public.points_transactions (
      customer_id, merchant_id, type, points, balance_after,
      source, source_id, description
    ) VALUES (
      p_customer_id, p_merchant_id, 'bonus', v_signup_bonus, v_signup_bonus,
      'loyalty_enrollment', v_loyalty_id::text, 'Loyalty signup bonus'
    );
  END IF;

  -- Referee half of "you both get X".
  IF v_referrer_customer_id IS NOT NULL AND v_referral_bonus > 0 THEN
    INSERT INTO public.points_transactions (
      customer_id, merchant_id, type, points, balance_after,
      source, source_id, description
    ) VALUES (
      p_customer_id, p_merchant_id, 'referral', v_referral_bonus, v_initial_points,
      'loyalty_referral', v_loyalty_id::text, 'Referral bonus - new member signup'
    );
  END IF;

  -- Referrer half, atomically with the enrollment.
  IF v_referrer_customer_id IS NOT NULL THEN
    UPDATE public.customer_loyalty
    SET
      points_balance = points_balance + v_referral_bonus,
      lifetime_points = lifetime_points + v_referral_bonus,
      referral_count = COALESCE(referral_count, 0) + 1,
      updated_at = pg_catalog.now()
    WHERE merchant_id = p_merchant_id
      AND customer_id = v_referrer_customer_id;

    IF v_referral_bonus > 0 THEN
      INSERT INTO public.points_transactions (
        customer_id, merchant_id, type, points, balance_after,
        source, source_id, description
      ) VALUES (
        v_referrer_customer_id, p_merchant_id, 'referral', v_referral_bonus,
        v_referrer_balance + v_referral_bonus,
        'loyalty_referral', v_loyalty_id::text, 'Referral bonus - friend joined'
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'points_balance', v_initial_points,
    'lifetime_points', v_initial_points,
    'current_tier', 'Bronze',
    'referral_code', v_referral_code,
    'referral_bonus_applied', v_referrer_customer_id IS NOT NULL AND v_referral_bonus > 0
  );
END;
$$;

-- Storefront customers (including guests, who hold no session) enroll through
-- the public route, so grant like the other customer-facing storefront RPCs.
-- The function fail-closes on program/customer/merchant checks above.
REVOKE ALL ON FUNCTION public.enroll_customer_loyalty(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enroll_customer_loyalty(uuid, uuid, text)
  TO anon, authenticated, service_role;
