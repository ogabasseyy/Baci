-- Fail closed on unknowable purchase minimums in manual consume
-- (issue #3165): migration 20 treated a NULL minimum snapshot as
-- eligible, but a pre-snapshot manual redemption whose reward was
-- deleted before migration 11 has both reward_id and
-- minimum_order_amount NULL — its original minimum is unknowable, so
-- staff could fulfill a code that may have required a purchase this
-- endpoint cannot verify. New no-minimum redemptions store 0
-- explicitly, and a NULL snapshot beside a live reward means that
-- reward carries no minimum (migration 11 backfilled the rest), so
-- only the NULL/NULL shape fails closed. Redefines the migration-20
-- function with that predicate; nothing else changes.
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
    AND public.loyalty_redemption_is_manual(rr.reward_type, rr.reward_value)
    -- Fail closed on a purchase minimum (mirrors the redemption RPC):
    -- this endpoint has no order amount to verify it against, and
    -- migration 11 backfilled the snapshot onto legacy manual codes,
    -- so a positive minimum must not be consumable here. A NULL
    -- snapshot is only eligible beside a live reward (known to carry
    -- no minimum); NULL with no reward is unknowable and excluded.
    AND (rr.minimum_order_amount <= 0
      OR (rr.minimum_order_amount IS NULL AND rr.reward_id IS NOT NULL))
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
      AND public.loyalty_redemption_is_manual(rr.reward_type, rr.reward_value);
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
