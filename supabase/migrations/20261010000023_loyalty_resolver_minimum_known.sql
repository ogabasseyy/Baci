-- Expose minimum knowability from the checkout resolver (issue #3165).
--
-- The order wrapper fails closed when a redemption's purchase minimum
-- is unknowable (null snapshot AND deleted reward: migration 11 could
-- not backfill those rows). Discount validation accepted the same
-- codes because the resolver only exposed the post-COALESCE minimum,
-- where "unknowable" and "no minimum" are both null. minimum_known
-- separates them: false exactly when neither the stamped snapshot nor
-- a live reward fallback exists.
DROP FUNCTION IF EXISTS public.get_loyalty_redemption_for_checkout(uuid, text);

CREATE FUNCTION public.get_loyalty_redemption_for_checkout(
  p_merchant_id uuid,
  p_code text
) RETURNS TABLE (
  redemption_id uuid,
  reward_type text,
  reward_value numeric,
  minimum_order_amount numeric,
  expires_at timestamptz,
  used boolean,
  issuance_currency text,
  reward_name text,
  max_redemption_percentage numeric,
  minimum_known boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id_required';
  END IF;
  IF p_code IS NULL OR pg_catalog.btrim(p_code) = '' THEN
    RAISE EXCEPTION 'code_required';
  END IF;
  RETURN QUERY
  SELECT
    rr.id,
    rr.reward_type::text,
    rr.reward_value,
    -- Issuance snapshot first: a merchant minimum raised after redeem
    -- cannot strand the paid code (new mints store explicit 0 for no
    -- minimum; only pre-fix NULL rows fall back to live).
    COALESCE(rr.minimum_order_amount, rw.minimum_order_amount),
    rr.expires_at,
    -- Effectively used: a claim stamped to a cancelled order is reusable
    -- (the release trigger skips rows locked by an in-flight retry, and
    -- cancelled is terminal so the read cannot stale). The wrapper
    -- re-verifies under lock before claiming.
    COALESCE(rr.used, false)
      AND NOT public.loyalty_status_is_cancelled(o.shipping_status)
      AND NOT public.loyalty_status_is_cancelled(o.payment_status),
    rr.issuance_currency,
    -- Issuance-time identity: the snapshot survives a merchant rename
    -- or deletion of the reward; the live name is only a fallback for
    -- rows minted before the snapshot existed.
    COALESCE(rr.reward_name, rw.name)::text,
    rr.max_redemption_percentage,
    rr.minimum_order_amount IS NOT NULL OR rw.id IS NOT NULL
  FROM public.reward_redemptions rr
  LEFT JOIN public.loyalty_rewards rw ON rw.id = rr.reward_id
  LEFT JOIN public.orders o ON o.id = rr.used_on_order_id
  WHERE rr.merchant_id = p_merchant_id
    AND pg_catalog.upper(rr.discount_code)
      = pg_catalog.upper(pg_catalog.btrim(p_code))
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_loyalty_redemption_for_checkout(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_loyalty_redemption_for_checkout(uuid, text)
  TO anon, authenticated, service_role;
