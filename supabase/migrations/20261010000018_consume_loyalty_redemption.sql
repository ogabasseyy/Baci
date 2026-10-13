-- Merchant consume path for manual-fulfillment redemptions (issue #3165).
--
-- redeem_loyalty_reward mints present-the-code codes for manual types
-- (free_shipping, free_product, exclusive_access, and valueless plain
-- discounts whose instructions say to present the code). Checkout never
-- honors them, so without a consume path they stay presentable until
-- expiry. This RPC is the single-use enforcement: one atomic UPDATE
-- under the caller's merchant access (owner or staff via
-- has_merchant_access), so authorized staff are not defeated by the
-- owner-only RLS policy on reward_redemptions.
CREATE OR REPLACE FUNCTION public.consume_loyalty_redemption(
  p_merchant_id uuid,
  p_code text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row record;
BEGIN
  IF p_merchant_id IS NULL OR p_code IS NULL
     OR pg_catalog.btrim(p_code) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_input');
  END IF;

  IF NOT public.has_merchant_access(p_merchant_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  -- used IS NOT TRUE mirrors the series' COALESCE(used, false)
  -- semantics: legacy rows can carry an explicit NULL.
  UPDATE public.reward_redemptions AS rr
  SET used = true, used_at = pg_catalog.now()
  WHERE rr.merchant_id = p_merchant_id
    AND pg_catalog.upper(rr.discount_code)
      = pg_catalog.upper(pg_catalog.btrim(p_code))
    AND rr.used IS NOT TRUE
    AND (rr.expires_at IS NULL OR rr.expires_at > pg_catalog.now())
    AND (
      rr.reward_type IN ('free_shipping', 'free_product', 'exclusive_access')
      OR (rr.reward_type = 'discount'
        AND COALESCE(rr.reward_value, 0) <= 0)
    )
  RETURNING rr.id, rr.discount_code, rr.reward_type, rr.customer_id, rr.used_at
  INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'redemption_not_found'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'redemption_id', v_row.id,
    'discount_code', v_row.discount_code,
    'reward_type', v_row.reward_type,
    'customer_id', v_row.customer_id,
    'used_at', v_row.used_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_loyalty_redemption(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_loyalty_redemption(uuid, text)
  TO authenticated, service_role;
