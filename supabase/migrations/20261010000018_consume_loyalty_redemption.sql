-- Permission helper for the consume RPC: the merchant owner, or an
-- active staff member whose effective permissions (role defaults
-- merged with custom grants, the same shapes permissionGrantsAccess
-- accepts in the API) include marketing:edit. Kept DEFINER-internal:
-- only the consume RPC calls it.
CREATE OR REPLACE FUNCTION public.loyalty_consume_is_authorized(
  p_merchant_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_staff_id uuid;
  v_perms jsonb;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.merchants AS m
    WHERE m.id = p_merchant_id AND m.user_id = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  SELECT s.id INTO v_staff_id
  FROM public.staff_members AS s
  WHERE s.merchant_id = p_merchant_id
    AND s.user_id = auth.uid()
    AND s.status = 'active';
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_perms := public.get_staff_permissions(v_staff_id);
  RETURN COALESCE((v_perms #>> '{full_access,all}')::boolean, false)
      OR COALESCE((v_perms #>> '{*,*}')::boolean, false)
      OR COALESCE((v_perms #>> '{*,edit}')::boolean, false)
      OR COALESCE((v_perms #>> '{marketing,*}')::boolean, false)
      OR COALESCE((v_perms #>> '{marketing,all}')::boolean, false)
      OR COALESCE((v_perms #>> '{marketing,edit}')::boolean, false);
END;
$$;

REVOKE ALL ON FUNCTION public.loyalty_consume_is_authorized(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.loyalty_consume_is_authorized(uuid)
  TO service_role;

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

  -- Permission lives here, not only in the API route: the DEFINER RPC
  -- is directly reachable through PostgREST by any authenticated staff
  -- session, so merchant access alone (any active staff) is not enough.
  IF NOT public.loyalty_consume_is_authorized(p_merchant_id) THEN
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
