-- Checkout bridge for loyalty reward codes (issue #3165).
--
-- Redeemed RDM-* codes lived only in reward_redemptions, which checkout
-- never read. This wires discount-typed codes (positive value) into
-- checkout: a resolve RPC here plus an order wrapper that claims the
-- code atomically (20261010000021_loyalty_checkout_order_wrapper.sql,
-- split out to respect the 300-line limit), mirroring
-- create_storefront_order_with_discount_code. Non-discount types stay
-- outside the bridge (manual fulfillment). Minimums ARE honored here
-- against the DB subtotal. Merchant-scoped case-insensitive code
-- uniqueness doubles as the lookup index.
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_redemption_checkout_code_idx
  ON public.reward_redemptions(merchant_id, pg_catalog.upper(discount_code));

-- Resolve a loyalty code for checkout. Read-only; the order wrapper
-- re-locks and re-verifies, so this stays lock-free. Anon-granted: the
-- validate route uses the anon client (bearer semantics, mirroring the
-- discount-code resolve).
CREATE OR REPLACE FUNCTION public.get_loyalty_redemption_for_checkout(
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
  max_redemption_percentage numeric
)
-- Snapshot-governed: issued codes never consult the live reward row, so
-- a later disable or delete cannot strand an already-paid code. The
-- redemption row carries every enforced term (type, value, minimum,
-- expiry); the live join below supplies the name only.
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
    rw.name::text,
    rr.max_redemption_percentage
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
