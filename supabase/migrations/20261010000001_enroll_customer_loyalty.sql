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
-- Pre-deploy: confirm no merchant has case-variant duplicates, or index
-- creation aborts:
--   SELECT merchant_id, upper(referral_code), count(*)
--   FROM public.customer_loyalty WHERE referral_code IS NOT NULL
--   GROUP BY 1, 2 HAVING count(*) > 1;
-- customer_loyalty is small (rows come only from purchase accrual), so a
-- plain index build is used instead of CONCURRENTLY.
DO $$
BEGIN
  -- Deduplicate legacy referral codes (the old 8-char generator had no
  -- uniqueness guard): keep one row per merchant+code, NULL the rest so
  -- the unique index below always applies. Balances are untouched.
  UPDATE public.customer_loyalty AS target
  SET referral_code = NULL
  WHERE referral_code IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.customer_loyalty AS keeper
      WHERE keeper.merchant_id = target.merchant_id
        AND upper(keeper.referral_code) = upper(target.referral_code)
        AND keeper.ctid < target.ctid
    );
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
  -- zero. FOR UPDATE pins the row through settlement (no deadlock: the
  -- settings endpoint never takes the advisory creation lock below).
  SELECT
    GREATEST(COALESCE(signup_bonus_points, 0), 0),
    GREATEST(COALESCE(referral_bonus_points, 0), 0)
  INTO v_signup_bonus, v_referral_bonus
  FROM public.loyalty_settings
  WHERE merchant_id = p_merchant_id
    AND enabled IS TRUE
  FOR UPDATE;

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
    -- Guest-checkout rows carry a NULL user_id, so a shopper whose row
    -- predates their login misses the ownership check above. Shoppers
    -- cannot read unlinked rows under RLS, so the re-link hint is
    -- evaluated here with the definer's rights instead of the route.
    -- Self-linkage only: the row must be unlinked, live, and email-match
    -- the caller's own verified login address, else this stays a plain
    -- customer_not_found (no oracle: the match key is server-side).
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

  -- Serialize account creation with purchase awards: award_purchase_points
  -- takes this same key before its own check-then-insert, so a first
  -- purchase racing enrollment cannot create a duplicate row or lose an
  -- award to a unique violation. Released at transaction end.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_merchant_id::text || ':' || p_customer_id::text)
  );

  -- Post-lock recheck: a racing first purchase may have created the row
  -- after the pre-lock check. Return already_enrolled explicitly (bonuses
  -- attach only to rows this function creates, so the race resolves like
  -- sequential award-then-enroll). The unique-violation handler below
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

  -- Totals are computed in bigint and range-checked (mirroring
  -- adjust_loyalty_points): the settings columns are unbounded integers,
  -- so two individually valid bonuses can sum past 2147483647 and would
  -- otherwise overflow mid-write into a 500 instead of a clean reject.
  -- Bonuses clamp non-negative above, so only the upper bound needs
  -- checking. The referrer row stays locked from the resolution above,
  -- so these verified addends also cover the settlement below.
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
