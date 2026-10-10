-- Atomic merchant-authorized manual points adjustment (issue #3165).
--
-- POST /api/loyalty/points did select-then-update with absolute balances
-- and no row lock, so concurrent awards (or an award racing a referral
-- credit) could read the same balance and overwrite each other; it also
-- created loyalty rows without checking the customers table, minting
-- orphan rows for typo'd or foreign customer IDs.
--
-- This SECURITY DEFINER RPC performs the whole adjustment in one
-- transaction: caller must own the merchant or be active staff,
-- customer must exist under this merchant and be writable, creation
-- serializes on the advisory lock shared with enrollment and purchase
-- awards, the member row is locked for the read-modify-write, and the
-- ledger insert commits atomically (no more tolerated partial writes).
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
    -- First award creates the row, retrying referral-code collisions
    -- like the enrollment RPC. On a unique violation the row is
    -- re-read: a concurrent writer that bypassed the advisory lock may
    -- have created it first, in which case it is adopted.
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

-- Merchant owners and staff adjust through the route, which resolves the
-- merchant from the session; the function re-verifies membership above.
REVOKE ALL ON FUNCTION public.adjust_loyalty_points(uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_loyalty_points(uuid, uuid, integer, text, text)
  TO authenticated, service_role;
