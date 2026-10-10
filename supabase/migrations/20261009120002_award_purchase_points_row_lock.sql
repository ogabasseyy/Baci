-- Coordinate purchase-point awards with referral credits (issue #3165).
--
-- enroll_customer_loyalty locks the referrer's customer_loyalty row while
-- crediting, but the baseline award_purchase_points read the same row
-- without FOR UPDATE and wrote stale absolute balances. A purchase read
-- landing before a referral credit (and writing after) silently overwrote
-- the credited balance even though the referral ledger recorded success.
--
-- Redefine the writer with a row lock plus an advisory creation lock
-- shared with enroll_customer_loyalty, projecting only the columns the
-- award consumes. Award behavior (tiers, ledger, returns) is unchanged.
-- Grants are preserved by CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION "public"."award_purchase_points"("p_customer_id" "uuid", "p_merchant_id" "uuid", "p_order_id" "uuid", "p_order_total" numeric) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_settings RECORD;
    v_loyalty RECORD;
    v_points_earned INTEGER;
    v_multiplier DECIMAL := 1.0;
    v_new_balance INTEGER;
    v_new_lifetime INTEGER;
    v_new_tier VARCHAR(50);
    v_expiry_date TIMESTAMPTZ;
BEGIN
    -- Serialize account creation with enrollments: enroll_customer_loyalty
    -- takes this same key before its own check-then-insert, so a first
    -- purchase racing enrollment cannot create a duplicate row or lose an
    -- award to a unique violation. Released at transaction end.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext(p_merchant_id::text || ':' || p_customer_id::text)
    );

    -- Get loyalty settings (project only the fields the award uses).
    SELECT points_currency_unit, points_per_currency, points_expiry_days, tiers
    INTO v_settings
    FROM public.loyalty_settings
    WHERE merchant_id = p_merchant_id AND enabled = TRUE;

    IF NOT FOUND THEN
        RETURN 0; -- Loyalty program not enabled
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
        INSERT INTO public.customer_loyalty (customer_id, merchant_id, referral_code)
        VALUES (
            p_customer_id,
            p_merchant_id,
            UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8))
        )
        RETURNING id, points_balance, lifetime_points, current_tier
        INTO v_loyalty;
    END IF;

    -- Get tier multiplier
    SELECT (tier->>'multiplier')::DECIMAL INTO v_multiplier
    FROM (
        SELECT jsonb_array_elements(v_settings.tiers) as tier
    ) t
    WHERE tier->>'name' = v_loyalty.current_tier;

    v_multiplier := COALESCE(v_multiplier, 1.0);

    -- Calculate points
    v_points_earned := FLOOR(
        (p_order_total / v_settings.points_currency_unit) *
        v_settings.points_per_currency *
        v_multiplier
    );

    IF v_points_earned <= 0 THEN
        RETURN 0;
    END IF;

    -- Calculate new balances
    v_new_balance := v_loyalty.points_balance + v_points_earned;
    v_new_lifetime := v_loyalty.lifetime_points + v_points_earned;
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
