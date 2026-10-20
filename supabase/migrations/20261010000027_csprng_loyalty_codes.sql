-- Mint loyalty codes from a CSPRNG (issue #3165, Muse review
-- follow-up): referral codes (enroll_customer_loyalty,
-- award_purchase_points, adjust_loyalty_points) and RDM- redemption
-- codes (redeem_loyalty_reward) were generated as
-- MD5(random() || clock_timestamp()) truncated to 8/12 hex chars.
-- PostgreSQL random() is a deterministic PRNG and the timestamp is
-- guessable, so the effective entropy sat far below the hex length
-- and codes accepted by the anon checkout resolver were predictable
-- enough to steal discounts. All four functions are re-issued
-- unchanged except the mint expression, which now encodes
-- extensions.gen_random_bytes (pgcrypto, from the baseline) at the
-- same lengths (8 hex referral, RDM- + 12 hex redemption); the
-- existing probe-and-retry collision loops are untouched.
--
-- Residual risk (accepted, auditable): nothing already issued is
-- reminted here. Outstanding RDM- codes expire 30 days after issue
-- (v_expires_at below), so that population decays on its own.
-- Permanent referral codes keep their shape and are NOT rotated
-- because reminting would invalidate already-shared referral links
-- (product decision, owner call). Code lengths are unchanged by
-- design (8 hex referral / RDM- + 12 hex redemption): enumeration is
-- bounded by the removed anon oracle (#3719 revoked anon and
-- authenticated EXECUTE on the checkout-code resolver) plus the
-- middleware default 50 req/min/IP ceiling (rate-limit-routes.ts).
-- Lengthening codes stays a follow-up option if abuse is observed.

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
    v_referral_code := pg_catalog.upper(pg_catalog.encode(extensions.gen_random_bytes(4), 'hex'));
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

REVOKE ALL ON FUNCTION public.enroll_customer_loyalty(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enroll_customer_loyalty(uuid, uuid, text)
  TO authenticated, service_role;
CREATE OR REPLACE FUNCTION "public"."award_purchase_points"("p_customer_id" "uuid", "p_merchant_id" "uuid", "p_order_id" "uuid", "p_order_total" numeric) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
DECLARE
    v_settings RECORD;
    v_loyalty RECORD;
    v_points_earned INTEGER;
    v_multiplier DECIMAL := 1.0;
    v_derived_tier TEXT;
    v_new_balance INTEGER;
    v_new_lifetime INTEGER;
    v_new_tier VARCHAR(50);
    v_expiry_date TIMESTAMPTZ;
    v_attempt INTEGER := 0;
    v_referral_code TEXT;
    v_created BOOLEAN := FALSE;
BEGIN
    -- Serialize account creation with enrollments: enroll_customer_loyalty
    -- takes this same key before its own check-then-insert, so a first
    -- purchase racing enrollment cannot create a duplicate row or lose an
    -- award to a unique violation. Released at transaction end.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext(p_merchant_id::text || ':' || p_customer_id::text)
    );

    -- Get loyalty settings (project only the fields the award uses).
    -- FOR SHARE pins the ladder through settlement like enrollment and
    -- redemption, so tier derivation and multiplier use one snapshot.
    SELECT points_currency_unit, points_per_currency, points_expiry_days, tiers
    INTO v_settings
    FROM public.loyalty_settings
    WHERE merchant_id = p_merchant_id AND enabled = TRUE
    FOR SHARE;

    IF NOT FOUND THEN
        RETURN 0; -- Loyalty program not enabled
    END IF;

    -- NULL or non-positive earning config awards nothing, checked before
    -- the membership below is created: without this a first purchase
    -- under a zero divisor would mint a bonus-less row (a PL/pgSQL
    -- return commits the insert) and silently forfeit signup bonuses.
    -- A NULL divisor would also yield NULL points (slipping past the
    -- <= 0 check) and a zero divisor raises, failing checkout.
    IF v_settings.points_currency_unit IS NULL
       OR v_settings.points_currency_unit <= 0
       OR v_settings.points_per_currency IS NULL
       OR v_settings.points_per_currency <= 0 THEN
        RETURN 0;
    END IF;

    -- Get or create customer loyalty account. Lock the row: concurrent
    -- writers (referral credits, other purchases) must serialize on the
    -- read-modify-write below instead of overwriting each other.
    SELECT id, points_balance, lifetime_points, current_tier
    INTO v_loyalty
    FROM public.customer_loyalty
    WHERE customer_id = p_customer_id AND merchant_id = p_merchant_id
    FOR UPDATE;

    IF NOT FOUND THEN
        -- Mint a referral code like the enrollment RPC: the case-insensitive
        -- unique index can reject a blindly generated code, so probe then
        -- retry instead of losing the award to a unique violation.
        LOOP
            v_attempt := v_attempt + 1;
            v_referral_code := pg_catalog.upper(pg_catalog.encode(extensions.gen_random_bytes(4), 'hex'));
            IF NOT EXISTS (
                SELECT 1
                FROM public.customer_loyalty
                WHERE merchant_id = p_merchant_id
                  AND UPPER(referral_code) = v_referral_code
            ) THEN
                BEGIN
                    INSERT INTO public.customer_loyalty (customer_id, merchant_id, referral_code)
                    VALUES (p_customer_id, p_merchant_id, v_referral_code)
                    RETURNING id, points_balance, lifetime_points, current_tier
                    INTO v_loyalty;
                    v_created := TRUE;
                    EXIT;
                EXCEPTION WHEN unique_violation THEN
                    -- Concurrent mint collided: fall through to mint again.
                    NULL;
                END;
            END IF;
            IF v_attempt >= 5 THEN
                -- Self-healing: no row was created, so a later purchase
                -- retries creation instead of wedging the account.
                RETURN 0;
            END IF;
        END LOOP;
    END IF;

    -- The multiplier follows the tier derived from CURRENT lifetime
    -- points, not the stored current_tier: a ladder edit or rename
    -- leaves stored names stale, and awarding at the former tier's
    -- rate (or the 1x rename fallback) misprices this purchase.
    v_derived_tier := public.calculate_loyalty_tier(
        COALESCE(v_loyalty.lifetime_points, 0), p_merchant_id);

    -- Tier multiplier follows the calculator's dedup (threshold order,
    -- case-insensitive, first/lowest wins): a raw-first match could award
    -- a higher duplicate's rate. Non-numeric multipliers fall back to 1.0
    -- like malformed containers instead of raising mid-award.
    IF jsonb_typeof(v_settings.tiers) = 'array' THEN
        SELECT CASE WHEN tier->>'multiplier' ~ '^-?[0-9]+(\.[0-9]+)?$'
                 THEN (tier->>'multiplier')::DECIMAL END INTO v_multiplier
        FROM (
            SELECT t.value AS tier
            FROM jsonb_array_elements(v_settings.tiers) WITH ORDINALITY AS t(value, ord)
            ORDER BY
                CASE WHEN t.value->>'minPoints' ~ '^-?[0-9]+$'
                  THEN (t.value->>'minPoints')::NUMERIC
                  ELSE NULL
                END ASC NULLS LAST,
                t.ord
        ) ordered
        WHERE pg_catalog.lower(ordered.tier->>'name') = pg_catalog.lower(v_derived_tier)
          -- Only usable rungs carry a multiplier (the calculator skips
          -- invalid thresholds when deriving the tier name).
          AND (ordered.tier->>'minPoints') ~ '^-?[0-9]+$'
        LIMIT 1;
    END IF;

    v_multiplier := COALESCE(v_multiplier, 1.0);

    -- Calculate points
    v_points_earned := FLOOR(
        (p_order_total / v_settings.points_currency_unit) *
        v_settings.points_per_currency *
        v_multiplier
    );

    IF v_points_earned IS NULL OR v_points_earned <= 0 THEN
        -- Remove the provisional row: a first purchase that earns nothing
        -- (zero/NULL total, zero multiplier) must not mint an
        -- already_enrolled membership that forfeits signup bonuses.
        IF v_created THEN
            DELETE FROM public.customer_loyalty WHERE id = v_loyalty.id;
        END IF;
        RETURN 0;
    END IF;

    -- Calculate new balances (nullable columns: a NULL balance would
    -- propagate into the UPDATE and the NOT NULL balance_after ledger).
    v_new_balance := COALESCE(v_loyalty.points_balance, 0) + v_points_earned;
    v_new_lifetime := COALESCE(v_loyalty.lifetime_points, 0) + v_points_earned;
    v_new_tier := public.calculate_loyalty_tier(v_new_lifetime, p_merchant_id);

    -- Calculate expiry date
    IF v_settings.points_expiry_days > 0 THEN
        v_expiry_date := NOW() + (v_settings.points_expiry_days || ' days')::INTERVAL;
    END IF;

    -- Update customer loyalty
    UPDATE public.customer_loyalty
    SET
        points_balance = v_new_balance,
        lifetime_points = v_new_lifetime,
        current_tier = v_new_tier,
        tier_updated_at = CASE WHEN v_new_tier != current_tier THEN NOW() ELSE tier_updated_at END,
        updated_at = NOW()
    WHERE id = v_loyalty.id;

    -- Record transaction
    INSERT INTO public.points_transactions (
        customer_id, merchant_id, type, points, balance_after,
        source, source_id, description, expires_at
    ) VALUES (
        p_customer_id, p_merchant_id, 'earn', v_points_earned, v_new_balance,
        'purchase', p_order_id::TEXT, 'Points earned from purchase', v_expiry_date
    );

    RETURN v_points_earned;
END;
$$;

REVOKE ALL ON FUNCTION public.award_purchase_points(uuid, uuid, uuid, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_purchase_points(uuid, uuid, uuid, numeric)
  TO authenticated, service_role;
-- award_purchase_points is invoker-rights (no SECURITY DEFINER) with an
-- empty search_path, and now resolves extensions.gen_random_bytes by
-- schema-qualified name. pgcrypto lives in the extensions schema
-- (baseline) with USAGE granted only on public, so the executing roles
-- need narrow USAGE here or first-purchase awards fail with
-- "permission denied for schema extensions". Scoped to exactly the
-- roles holding EXECUTE above; the other three reissued functions are
-- SECURITY DEFINER and unaffected.
GRANT USAGE ON SCHEMA extensions TO authenticated, service_role;

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
    -- Reject types with no fulfillment path before any mutation
    -- (shared allowlist, migration 20261009235959). Manual types mint
    -- a present-the-code redemption; checkout never honors them.
    AND public.loyalty_reward_type_is_fulfillable(reward_type)
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
     AND public.loyalty_reward_is_checkout_discount(
       v_reward.reward_type, v_reward.reward_value) THEN
    RETURN jsonb_build_object('success', false, 'error', 'reward_unavailable');
  END IF;
  -- Valued rewards need a positive value (percentages <= 100;
  -- shared predicate with the status catalog, migration 20261009235959).
  IF NOT public.loyalty_reward_value_is_usable(
    v_reward.reward_type, v_reward.reward_value
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'reward_unavailable');
  END IF;
  -- Minimum-gated store credit and manual-fulfillment rewards fail
  -- closed: neither has an order amount to enforce the minimum against
  -- (checkout for store credit, the consume endpoint for manual types).
  IF v_reward.minimum_order_amount IS NOT NULL
     AND v_reward.minimum_order_amount > 0
     AND (v_reward.reward_type = 'store_credit'
       OR public.loyalty_redemption_is_manual(
         v_reward.reward_type, v_reward.reward_value)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'reward_unavailable');
  END IF;
  -- Fixed values rounding to zero units: reject before deduction.
  IF public.loyalty_reward_fixed_value_is_dead(
    v_reward.reward_type, v_reward.reward_value
  ) THEN
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
    v_redemption_code := 'RDM-' || pg_catalog.upper(pg_catalog.encode(extensions.gen_random_bytes(6), 'hex'));
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
CREATE OR REPLACE FUNCTION public.adjust_loyalty_points(
  p_merchant_id uuid,
  p_customer_id uuid,
  p_points integer,
  p_reason text,
  p_type text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_loyalty record;
  v_new_balance bigint := 0;
  v_new_lifetime bigint := 0;
  v_new_tier character varying(50);
  v_referral_code text;
  v_attempt integer := 0;
  v_description text;
BEGIN
  IF p_merchant_id IS NULL
     OR p_customer_id IS NULL
     OR p_points IS NULL
     OR p_points = 0
     OR p_type IS DISTINCT FROM 'adjust' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_input');
  END IF;

  -- Caller must own this merchant. The RLS write policies on
  -- customer_loyalty and points_transactions admit owners only, and the
  -- pre-RPC session-client writes rejected staff through them; matching
  -- that bound here keeps this DEFINER function from minting a broader
  -- privilege than the tables allow. (The route resolves staff too, but
  -- performs no finer permission check, so staff fail closed here.)
  PERFORM 1
  FROM public.merchants
  WHERE id = p_merchant_id
    AND user_id = auth.uid();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'merchant_not_found');
  END IF;

  -- The customer must exist under this merchant and be writable.
  PERFORM 1
  FROM public.customers
  WHERE id = p_customer_id
    AND merchant_id = p_merchant_id
    AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'customer_not_found');
  END IF;

  -- Serialize account creation with enrollments and purchase awards.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_merchant_id::text || ':' || p_customer_id::text)
  );

  -- Lock the member row: concurrent adjustments must serialize on the
  -- read-modify-write below instead of overwriting each other.
  SELECT id, points_balance, lifetime_points, current_tier
  INTO v_loyalty
  FROM public.customer_loyalty
  WHERE merchant_id = p_merchant_id
    AND customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- A negative first adjustment can never succeed (0 + negative is
    -- below zero), so reject before inserting: creating the row first
    -- would commit a membership the failure return cannot roll back,
    -- blocking later signup and referral bonuses.
    IF p_points < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'negative_balance');
    END IF;
    -- First award creates the row, retrying referral-code collisions
    -- like the enrollment RPC. On a unique violation the row is
    -- re-read: a concurrent writer that bypassed the advisory lock may
    -- have created it first, in which case it is adopted.
    LOOP
      v_attempt := v_attempt + 1;
      v_referral_code := pg_catalog.upper(pg_catalog.encode(extensions.gen_random_bytes(4), 'hex'));
      IF NOT EXISTS (
        SELECT 1
        FROM public.customer_loyalty
        WHERE merchant_id = p_merchant_id
          AND pg_catalog.upper(referral_code) = v_referral_code
      ) THEN
        BEGIN
          INSERT INTO public.customer_loyalty (
            merchant_id, customer_id, points_balance, lifetime_points,
            current_tier, referral_code
          ) VALUES (
            p_merchant_id, p_customer_id, 0, 0, 'Bronze', v_referral_code
          )
          RETURNING id, points_balance, lifetime_points, current_tier
          INTO v_loyalty;
          EXIT;
        EXCEPTION WHEN unique_violation THEN
          SELECT id, points_balance, lifetime_points, current_tier
          INTO v_loyalty
          FROM public.customer_loyalty
          WHERE merchant_id = p_merchant_id
            AND customer_id = p_customer_id
          FOR UPDATE;
          IF FOUND THEN
            EXIT;
          END IF;
          -- Referral-code conflict: fall through to mint again below.
        END;
      END IF;
      IF v_attempt >= 5 THEN
        RETURN jsonb_build_object('success', false, 'error', 'creation_failed');
      END IF;
    END LOOP;
  END IF;

  -- Balances are nullable in the schema, so coalesce before crediting.
  -- Totals are computed in bigint and range-checked: the columns are
  -- integer, and an in-range delta on a near-limit balance would
  -- otherwise overflow mid-write into a 500 instead of a clean reject.
  v_new_balance := COALESCE(v_loyalty.points_balance, 0)::bigint + p_points;
  v_new_lifetime := COALESCE(v_loyalty.lifetime_points, 0)::bigint
    + CASE WHEN p_points > 0 THEN p_points ELSE 0 END;
  IF v_new_balance > 2147483647
     OR v_new_balance < -2147483648
     OR v_new_lifetime > 2147483647 THEN
    RETURN jsonb_build_object('success', false, 'error', 'out_of_range');
  END IF;
  IF v_new_balance < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'negative_balance');
  END IF;
  -- Range-checked above: the casts cannot overflow.
  v_new_tier := public.calculate_loyalty_tier(
    v_new_lifetime::integer, p_merchant_id
  );

  UPDATE public.customer_loyalty
  SET points_balance = v_new_balance,
      lifetime_points = v_new_lifetime,
      current_tier = v_new_tier,
      tier_updated_at = CASE
        WHEN v_new_tier IS DISTINCT FROM current_tier
        THEN pg_catalog.now()
        ELSE tier_updated_at
      END,
      updated_at = pg_catalog.now()
  WHERE id = v_loyalty.id;

  v_description := COALESCE(
    NULLIF(pg_catalog.btrim(p_reason), ''),
    'Manual adjustment by merchant: '
      || CASE WHEN p_points > 0 THEN '+' ELSE '' END
      || p_points
      || ' points'
  );
  INSERT INTO public.points_transactions (
    customer_id, merchant_id, type, points, balance_after,
    source, description
  ) VALUES (
    p_customer_id, p_merchant_id, 'adjust', p_points, v_new_balance,
    'admin_adjust', v_description
  );

  RETURN jsonb_build_object(
    'success', true,
    'new_balance', v_new_balance,
    'lifetime_points', v_new_lifetime,
    'points_awarded', p_points
  );
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_loyalty_points(uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_loyalty_points(uuid, uuid, integer, text, text)
  TO authenticated, service_role;