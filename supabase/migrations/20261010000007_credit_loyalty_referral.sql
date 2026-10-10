-- Referral-bonus settlement for enroll_customer_loyalty (issue #3165).
--
-- Extracted from migration 01: that file sits at the repository's
-- 300-line limit, and this block is straight-line writes with no
-- dependency on the caller's other state. The caller range-checks the
-- combined bonuses in bigint before the member insert (mirroring
-- adjust_loyalty_points), so the additions below cannot overflow. Only
-- the enrollment RPC calls this (definer's rights); direct execution
-- stays closed.
CREATE OR REPLACE FUNCTION public.credit_loyalty_referral(
  p_merchant_id uuid,
  p_customer_id uuid,
  p_referrer_customer_id uuid,
  p_referral_bonus integer,
  p_initial_points integer,
  p_loyalty_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_referrer_balance integer := 0;
BEGIN
  IF p_referrer_customer_id IS NULL THEN
    RETURN;
  END IF;

  -- Re-read under lock: the caller holds this same row lock from
  -- referral-code resolution, so this is instant and identical; taking
  -- the lock here also keeps this correct if the call order changes.
  SELECT COALESCE(points_balance, 0)
  INTO v_referrer_balance
  FROM public.customer_loyalty
  WHERE merchant_id = p_merchant_id
    AND customer_id = p_referrer_customer_id
  FOR UPDATE;

  -- Referee half of "you both get X".
  IF p_referral_bonus > 0 THEN
    INSERT INTO public.points_transactions (
      customer_id, merchant_id, type, points, balance_after,
      source, source_id, description
    ) VALUES (
      p_customer_id, p_merchant_id, 'referral', p_referral_bonus, p_initial_points,
      'loyalty_referral', p_loyalty_id::text, 'Referral bonus - new member signup'
    );
  END IF;

  -- Referrer half, atomically with the enrollment. Balances are nullable
  -- in the schema, so coalesce before crediting (legacy rows predate the
  -- DEFAULT 0 backfill path). referral_count tracks code usage
  -- (attribution), not paid bonuses: it increments even when the
  -- configured bonus is zero.
  UPDATE public.customer_loyalty
  SET
    points_balance = COALESCE(points_balance, 0) + p_referral_bonus,
    lifetime_points = COALESCE(lifetime_points, 0) + p_referral_bonus,
    current_tier = public.calculate_loyalty_tier(
      COALESCE(lifetime_points, 0) + p_referral_bonus, p_merchant_id
    ),
    tier_updated_at = CASE
      WHEN public.calculate_loyalty_tier(
        COALESCE(lifetime_points, 0) + p_referral_bonus, p_merchant_id
      ) IS DISTINCT FROM current_tier
      THEN pg_catalog.now()
      ELSE tier_updated_at
    END,
    referral_count = COALESCE(referral_count, 0) + 1,
    updated_at = pg_catalog.now()
  WHERE merchant_id = p_merchant_id
    AND customer_id = p_referrer_customer_id;

  IF p_referral_bonus > 0 THEN
    INSERT INTO public.points_transactions (
      customer_id, merchant_id, type, points, balance_after,
      source, source_id, description
    ) VALUES (
      p_referrer_customer_id, p_merchant_id, 'referral', p_referral_bonus,
      v_referrer_balance + p_referral_bonus,
      'loyalty_referral', p_loyalty_id::text, 'Referral bonus - friend joined'
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_loyalty_referral(uuid, uuid, uuid, integer, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_loyalty_referral(uuid, uuid, uuid, integer, integer, uuid)
  TO service_role;
