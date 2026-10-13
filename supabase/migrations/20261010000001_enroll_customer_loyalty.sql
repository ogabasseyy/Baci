-- Atomic loyalty enrollment (issue #3165).
--
-- POST /api/storefront/loyalty/enroll referenced nonexistent columns and a
-- nonexistent increment RPC, so it 500'd while the UI advertised bonuses.
--
-- This SECURITY DEFINER RPC enrolls in one transaction against the real
-- schema: loyalty_settings(signup/referral bonuses),
-- customer_loyalty(current_tier, referred_by_customer_id),
-- points_transactions(balance_after/source NOT NULL).
--
-- Product decision (issue #3165, option a): the single referral_bonus_points
-- value is awarded to BOTH the referrer and the referee ("you both get X").
--
-- Authorization: the caller must own the customer row (customers.user_id =
-- auth.uid()). Anonymous execution is revoked; the storefront route also
-- binds the session to the customer before calling.

-- Referral codes are matched case-insensitively, so uniqueness must be
-- case-insensitive too. The mint loop retries on this constraint.
-- Legacy duplicates are reminted below, so the index always applies.
-- customer_loyalty is small (rows come only from purchase accrual), so a
-- plain index build is used instead of CONCURRENTLY.
DO $$
DECLARE
  loser record;
  v_code text;
BEGIN
  -- Remint duplicate legacy referral codes (the old 8-char generator had
  -- no uniqueness guard): each loser gets a fresh merchant-unique code so
  -- the unique index below always applies and nobody loses referrals.
  FOR loser IN
    SELECT target.ctid AS row_ctid, target.merchant_id AS merchant_id
    FROM public.customer_loyalty AS target
    WHERE target.referral_code IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.customer_loyalty AS keeper
        WHERE keeper.merchant_id = target.merchant_id
          AND upper(keeper.referral_code) = upper(target.referral_code)
          AND keeper.ctid < target.ctid
      )
  LOOP
    LOOP
      v_code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT || CLOCK_TIMESTAMP()::TEXT) FROM 1 FOR 8));
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.customer_loyalty
        WHERE merchant_id = loser.merchant_id
          AND upper(referral_code) = v_code
      );
    END LOOP;
    UPDATE public.customer_loyalty
    SET referral_code = v_code
    WHERE ctid = loser.row_ctid;
  END LOOP;
END;
$$;
CREATE UNIQUE INDEX IF NOT EXISTS customer_loyalty_merchant_referral_code_key
  ON public.customer_loyalty (merchant_id, upper(referral_code));

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
  v_referrer_lifetime integer := 0;
  v_initial_points integer := 0;
  v_initial_total bigint := 0;
  v_referrer_new_balance bigint := 0;
  v_referrer_new_lifetime bigint := 0;
  v_initial_tier text := 'Bronze';
  v_loyalty_id uuid;
  v_referral_code text;
  v_attempt integer := 0;
  v_constraint text;
BEGIN
  IF p_merchant_id IS NULL OR p_customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_input');
  END IF;

  -- Fail closed when the program is missing/disabled; clamp negatives to
  -- zero. FOR SHARE pins the snapshot through settlement without
  -- serializing concurrent enrollments/redemptions on the row (the
  -- settings endpoint never takes the advisory creation lock below).
  SELECT
    GREATEST(COALESCE(signup_bonus_points, 0), 0),
    GREATEST(COALESCE(referral_bonus_points, 0), 0)
  INTO v_signup_bonus, v_referral_bonus
  FROM public.loyalty_settings
  WHERE merchant_id = p_merchant_id
    AND enabled IS TRUE
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'program_unavailable');
  END IF;

  -- Existence, liveness, and ownership in one predicate (single
  -- customer_not_found discloses nothing; NULL auth.uid() never matches;
  -- soft-deleted rows are non-writable).
  PERFORM 1
  FROM public.customers
  WHERE id = p_customer_id
    AND merchant_id = p_merchant_id
    AND deleted_at IS NULL
    AND user_id = auth.uid();

  IF NOT FOUND THEN
    -- Guest rows (NULL user_id) predate login and miss the check above;
    -- the re-link hint runs with definer rights (shoppers cannot read
    -- unlinked rows). Self-linkage only: unlinked, live, email-matching
    -- the verified login, else plain customer_not_found (no oracle).
    PERFORM 1
    FROM public.customers AS guest
    JOIN auth.users AS login ON login.id = auth.uid()
    WHERE guest.id = p_customer_id
      AND guest.merchant_id = p_merchant_id
      AND guest.user_id IS NULL
      AND guest.deleted_at IS NULL
      AND guest.email IS NOT NULL
      AND login.email_confirmed_at IS NOT NULL
      AND pg_catalog.lower(guest.email) = pg_catalog.lower(login.email);
    IF FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'guest_link_required');
    END IF;
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

  -- Serialize creation with purchase awards (same advisory key), so a
  -- racing first purchase cannot duplicate the row. Released at end.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_merchant_id::text || ':' || p_customer_id::text)
  );

  -- Post-lock recheck: a racing purchase may have created the row; its
  -- bonuses stay with the creator (sequential-equivalent). The handler
  -- below stays as a net for lock bypassers.
  PERFORM 1
  FROM public.customer_loyalty
  WHERE merchant_id = p_merchant_id
    AND customer_id = p_customer_id;

  IF FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_enrolled');
  END IF;

  -- Resolve the referrer (unknown codes ignored, matching the old route;
  -- no self-match: no self row exists yet; soft-deleted referrers read
  -- as unknown so no credit lands on a non-writable account).
  IF p_referral_code IS NOT NULL AND pg_catalog.btrim(p_referral_code) <> '' THEN
    SELECT referrer.customer_id, referrer.points_balance,
      referrer.lifetime_points
    INTO v_referrer_customer_id, v_referrer_balance, v_referrer_lifetime
    FROM public.customer_loyalty AS referrer
    WHERE referrer.merchant_id = p_merchant_id
      AND pg_catalog.upper(referrer.referral_code)
        = pg_catalog.upper(pg_catalog.btrim(p_referral_code))
      AND EXISTS (
        SELECT 1
        FROM public.customers AS referrer_customer
        WHERE referrer_customer.id = referrer.customer_id
          AND referrer_customer.merchant_id = p_merchant_id
          AND referrer_customer.deleted_at IS NULL
      )
    FOR UPDATE;

    v_referrer_balance := COALESCE(v_referrer_balance, 0);
    v_referrer_lifetime := COALESCE(v_referrer_lifetime, 0);
  END IF;

  -- Bigint totals, range-checked (mirrors adjust_loyalty_points): the
  -- unbounded settings columns could otherwise overflow mid-write into
  -- a 500. Non-negative above, so only the upper bound needs checking;
  -- the locked referrer row keeps these addends valid for settlement.
  IF v_referrer_customer_id IS NOT NULL THEN
    v_initial_total := v_signup_bonus::bigint + v_referral_bonus::bigint;
    v_referrer_new_balance :=
      v_referrer_balance::bigint + v_referral_bonus::bigint;
    v_referrer_new_lifetime :=
      v_referrer_lifetime::bigint + v_referral_bonus::bigint;
  ELSE
    v_initial_total := v_signup_bonus::bigint;
  END IF;
  IF v_initial_total > 2147483647
     OR v_referrer_new_balance > 2147483647
     OR v_referrer_new_lifetime > 2147483647 THEN
    RETURN jsonb_build_object('success', false, 'error', 'out_of_range');
  END IF;
  v_initial_points := v_initial_total::integer;
  v_initial_tier := public.calculate_loyalty_tier(v_initial_points, p_merchant_id);

  -- Mint a referral code: probe first, retry the insert on unique
  -- collisions (5 attempts).
  LOOP
    v_attempt := v_attempt + 1;
    v_referral_code := pg_catalog.upper(
      pg_catalog.substring(
        pg_catalog.md5(pg_catalog.random()::text || pg_catalog.clock_timestamp()::text),
        1,
        8
      )
    );
    IF NOT EXISTS (
      SELECT 1
      FROM public.customer_loyalty
      WHERE merchant_id = p_merchant_id
        AND pg_catalog.upper(referral_code) = v_referral_code
    ) THEN
      BEGIN
        INSERT INTO public.customer_loyalty (
          merchant_id, customer_id, points_balance, lifetime_points,
          current_tier, referral_code, referred_by_customer_id
        ) VALUES (
          p_merchant_id, p_customer_id, v_initial_points, v_initial_points,
          v_initial_tier, v_referral_code, v_referrer_customer_id
        )
        RETURNING id INTO v_loyalty_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
        IF v_constraint = 'customer_loyalty_customer_id_merchant_id_key' THEN
          -- Lost a concurrent-enrollment race on UNIQUE (customer_id, merchant_id).
          RETURN jsonb_build_object('success', false, 'error', 'already_enrolled');
        END IF;
        -- Referral-code conflict: fall through to mint again below.
      END;
    END IF;
    IF v_attempt >= 5 THEN
      RETURN jsonb_build_object('success', false, 'error', 'referral_code_collision');
    END IF;
  END LOOP;

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

  -- Referral settlement lives in credit_loyalty_referral (migration 07):
  -- straight-line writes, extracted because this file sits at the
  -- repository's 300-line limit. Totals were range-checked above, so the
  -- additions there cannot overflow.
  IF v_referrer_customer_id IS NOT NULL THEN
    PERFORM public.credit_loyalty_referral(
      p_merchant_id, p_customer_id, v_referrer_customer_id,
      v_referral_bonus, v_initial_points, v_loyalty_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'points_balance', v_initial_points,
    'lifetime_points', v_initial_points,
    'current_tier', v_initial_tier,
    'referral_code', v_referral_code,
    'referral_bonus_applied', v_referrer_customer_id IS NOT NULL AND v_referral_bonus > 0
  );
END;
$$;

-- The route binds the session; the function re-verifies ownership.
-- Revoke named roles too (baseline defaults grant anon/authenticated
-- directly, not via PUBLIC).
REVOKE ALL ON FUNCTION public.enroll_customer_loyalty(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_customer_loyalty(uuid, uuid, text)
  TO authenticated, service_role;
