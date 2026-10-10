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
--
-- Authorization: the caller must own the customer row (customers.user_id =
-- auth.uid()). Anonymous execution is revoked; the storefront route also
-- binds the session to the customer before calling.

-- Referral codes are matched case-insensitively, so uniqueness must be
-- case-insensitive too. The mint loop retries on this constraint.
-- Pre-deploy: confirm no merchant has case-variant duplicates, or index
-- creation aborts:
--   SELECT merchant_id, upper(referral_code), count(*)
--   FROM public.customer_loyalty WHERE referral_code IS NOT NULL
--   GROUP BY 1, 2 HAVING count(*) > 1;
-- customer_loyalty is small (the enroll path never worked; rows come from
-- the purchase-accrual path with random codes), so a plain index build is
-- used instead of CONCURRENTLY.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.customer_loyalty
    WHERE referral_code IS NOT NULL
    GROUP BY merchant_id, upper(referral_code)
    HAVING count(*) > 1
  ) THEN
    RAISE WARNING 'customer_loyalty has case-variant duplicate referral codes; unique index creation will fail';
  END IF;
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
  v_initial_points integer := 0;
  v_initial_tier text := 'Bronze';
  v_loyalty_id uuid;
  v_referral_code text;
  v_attempt integer := 0;
  v_constraint text;
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
  -- Existence, liveness, and ownership in one predicate: a single
  -- customer_not_found avoids disclosing which customer IDs exist to direct
  -- RPC callers. auth.uid() is NULL for callers without a JWT, which never
  -- matches, so this fail-closes. Soft-deleted rows are non-writable.
  PERFORM 1
  FROM public.customers
  WHERE id = p_customer_id
    AND merchant_id = p_merchant_id
    AND deleted_at IS NULL
    AND user_id = auth.uid();

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

  -- Serialize account creation with purchase awards: award_purchase_points
  -- takes this same key before its own check-then-insert, so a first
  -- purchase racing enrollment cannot create a duplicate row or lose an
  -- award to a unique violation. Released at transaction end.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_merchant_id::text || ':' || p_customer_id::text)
  );

  -- Post-lock recheck: a first purchase racing enrollment may have
  -- created the row after the pre-lock check above (the award takes this
  -- same key, so the winner committed before this lock was granted).
  -- Return already_enrolled explicitly instead of falling through to the
  -- insert's unique-violation handler. Bonuses attach only to rows this
  -- function creates: an award-created row keeps the sequential
  -- purchase-first outcome (no signup/referral bonus), so the race
  -- resolves exactly like award-then-enroll run in order. Crediting
  -- bonuses onto pre-existing rows would be a contract change for
  -- already_enrolled, not a race fix. The unique-violation handler below
  -- stays as a net for writers that bypass the advisory lock.
  PERFORM 1
  FROM public.customer_loyalty
  WHERE merchant_id = p_merchant_id
    AND customer_id = p_customer_id;

  IF FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_enrolled');
  END IF;

  -- Resolve the referrer. Unknown codes are ignored so a bad code never
  -- blocks enrollment (matches previous route behavior). A self-referral
  -- cannot match: the enrolling customer has no loyalty row yet (double
  -- enrollment is rejected above), so no self-row exists to resolve.
  -- Soft-deleted referrers are treated as unknown: their code must not
  -- credit a non-writable account.
  IF p_referral_code IS NOT NULL AND pg_catalog.btrim(p_referral_code) <> '' THEN
    SELECT referrer.customer_id, referrer.points_balance
    INTO v_referrer_customer_id, v_referrer_balance
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
  END IF;

  IF v_referrer_customer_id IS NOT NULL THEN
    v_initial_points := v_signup_bonus + v_referral_bonus;
  ELSE
    v_initial_points := v_signup_bonus;
  END IF;
  v_initial_tier := public.calculate_loyalty_tier(v_initial_points, p_merchant_id);

  -- Mint a referral code for the new member. The probe avoids the exception
  -- path in the common case; the insert retries on the unique index when
  -- concurrent mints collide. Every iteration consumes one of 5 attempts.
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

  -- Referrer half, atomically with the enrollment. Balances are nullable
  -- in the schema, so coalesce before crediting (legacy rows predate the
  -- DEFAULT 0 backfill path). referral_count tracks code usage
  -- (attribution), not paid bonuses: it increments even when the
  -- configured bonus is zero.
  IF v_referrer_customer_id IS NOT NULL THEN
    UPDATE public.customer_loyalty
    SET
      points_balance = COALESCE(points_balance, 0) + v_referral_bonus,
      lifetime_points = COALESCE(lifetime_points, 0) + v_referral_bonus,
      current_tier = public.calculate_loyalty_tier(
        COALESCE(lifetime_points, 0) + v_referral_bonus, p_merchant_id
      ),
      tier_updated_at = CASE
        WHEN public.calculate_loyalty_tier(
          COALESCE(lifetime_points, 0) + v_referral_bonus, p_merchant_id
        ) IS DISTINCT FROM current_tier
        THEN pg_catalog.now()
        ELSE tier_updated_at
      END,
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
    'current_tier', v_initial_tier,
    'referral_code', v_referral_code,
    'referral_bonus_applied', v_referrer_customer_id IS NOT NULL AND v_referral_bonus > 0
  );
END;
$$;

-- Authenticated storefront customers enroll through the route, which binds
-- the session to the customer; the function re-verifies ownership above.
-- Anonymous execution stays revoked so the RPC is never directly invocable
-- without a session.
-- Revoke from the named roles too: baseline default privileges grant new
-- functions directly to anon/authenticated (not via PUBLIC), so a
-- PUBLIC-only revoke would leave anon execution intact.
REVOKE ALL ON FUNCTION public.enroll_customer_loyalty(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_customer_loyalty(uuid, uuid, text)
  TO authenticated, service_role;
