-- Bind manual-consumption replay to a consume-attempt key (issue
-- #3165): the used-row fallback in consume_loyalty_redemption cannot
-- otherwise tell a lost-response retry of the same consume attempt
-- from a later re-presentation of the same code. The first successful
-- consume stamps the attempt key on the redemption; a retry replays
-- the success receipt only when it presents that same key. Any other
-- presentation of a used code returns an explicit already_consumed
-- result carrying the original receipt, never a second success.
-- Codes consumed before this migration carry no stamped key: their
-- used-row presentations report already_consumed (staff can see the
-- original used_at) instead of replaying success.
ALTER TABLE public.reward_redemptions
  ADD COLUMN IF NOT EXISTS consume_idempotency_key text;

DROP FUNCTION IF EXISTS public.consume_loyalty_redemption(uuid, text);

CREATE OR REPLACE FUNCTION public.consume_loyalty_redemption(
  p_merchant_id uuid,
  p_code text,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row record;
  v_is_retry boolean := false;
  v_reward_name text;
  v_reward_product_id uuid;
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
  SET used = true, used_at = pg_catalog.now(),
      consume_idempotency_key = COALESCE(
        NULLIF(pg_catalog.btrim(COALESCE(p_idempotency_key, '')), ''),
        rr.consume_idempotency_key
      )
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
  RETURNING rr.id, rr.discount_code, rr.reward_type, rr.reward_id,
    rr.reward_name, rr.reward_product_id, rr.customer_id, rr.used_at,
    rr.consume_idempotency_key
  INTO v_row;

  IF NOT FOUND THEN
    -- Lost-response retry: a code already consumed MANUALLY (used, no
    -- order stamp) replays its receipt so staff can still fulfill;
    -- checkout-claimed codes (order stamp present) stay not-found.
    SELECT rr.id, rr.discount_code, rr.reward_type, rr.reward_id,
      rr.reward_name, rr.reward_product_id, rr.customer_id, rr.used_at,
      rr.consume_idempotency_key
    INTO v_row
    FROM public.reward_redemptions AS rr
    WHERE rr.merchant_id = p_merchant_id
      AND pg_catalog.upper(rr.discount_code)
        = pg_catalog.upper(pg_catalog.btrim(p_code))
      AND rr.used IS TRUE
      AND rr.used_on_order_id IS NULL
      AND (
        rr.reward_type IN ('free_shipping', 'free_product', 'exclusive_access')
        OR (rr.reward_type = 'discount'
          AND COALESCE(rr.reward_value, 0) <= 0)
      );
    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false, 'error', 'redemption_not_found'
      );
    END IF;
    v_is_retry := true;
  END IF;

  -- Fulfillment identity for the caller: staff were given this path
  -- precisely because their RLS client cannot inspect the redemption
  -- afterward, so say WHICH reward (and product, for free_product)
  -- the presented code was for. The reward row may since be deleted
  -- (reward_id SET NULL), leaving the type as the only identity.
  -- Prefer the issuance snapshots (minted onto the redemption);
  -- pre-snapshot rows fall back to the live reward row.
  v_reward_name := v_row.reward_name;
  v_reward_product_id := v_row.reward_product_id;
  IF v_reward_name IS NULL AND v_row.reward_id IS NOT NULL THEN
    SELECT lr.name, lr.reward_product_id
    INTO v_reward_name, v_reward_product_id
    FROM public.loyalty_rewards AS lr
    WHERE lr.id = v_row.reward_id;
  END IF;

  -- Replay gate: on the used-row retry path, success replays only
  -- when the presented attempt key matches the key the first consume
  -- stamped. A keyless, mismatched, or pre-key consumption is a
  -- re-presentation, not a retry: report already_consumed with the
  -- original receipt instead of a second success.
  IF v_is_retry
     AND (v_row.consume_idempotency_key IS NULL
       OR v_row.consume_idempotency_key IS DISTINCT FROM NULLIF(
         pg_catalog.btrim(COALESCE(p_idempotency_key, '')), '')) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'already_consumed',
      'redemption_id', v_row.id,
      'discount_code', v_row.discount_code,
      'reward_type', v_row.reward_type,
      'reward_id', v_row.reward_id,
      'reward_name', v_reward_name,
      'reward_product_id', v_reward_product_id,
      'customer_id', v_row.customer_id,
      'used_at', v_row.used_at
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'redemption_id', v_row.id,
    'discount_code', v_row.discount_code,
    'reward_type', v_row.reward_type,
    'reward_id', v_row.reward_id,
    'reward_name', v_reward_name,
    'reward_product_id', v_reward_product_id,
    'customer_id', v_row.customer_id,
    'used_at', v_row.used_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_loyalty_redemption(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_loyalty_redemption(uuid, text, text)
  TO authenticated, service_role;
