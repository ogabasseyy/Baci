-- Issuance-currency snapshot for loyalty redemptions (issue #3165).
--
-- Fixed-value codes snapshot only numbers at mint: a merchant who later
-- changes payout_currency would silently re-denominate an already-paid
-- code (a NGN 5,000 code becoming a $5,000 discount). Stamp the
-- merchant's resolved currency on the redemption row at mint; the
-- checkout bridge rejects fixed codes whose issuance currency differs
-- from the order currency. Percentage codes are proportional and stay
-- currency-agnostic.
ALTER TABLE public.reward_redemptions
  ADD COLUMN IF NOT EXISTS issuance_currency text;

-- Canonical resolver for ISSUANCE stamps: exactly the rule
-- private.create_storefront_order stamps orders with (a non-blank
-- payout currency uppercased, else NGN). The country fallback the
-- display resolver applies must NOT leak in here: a code stamped USD
-- for a blank-payout US merchant would meet NGN-stamped orders and be
-- born checkout-incompatible (loyalty_code_currency_mismatch).
CREATE OR REPLACE FUNCTION public.merchant_resolved_currency(
  p_merchant_id uuid
) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payout text;
BEGIN
  SELECT m.payout_currency
  INTO v_payout
  FROM public.merchants AS m
  WHERE m.id = p_merchant_id;
  IF NOT FOUND THEN
    RETURN 'NGN';
  END IF;

  v_payout := pg_catalog.upper(pg_catalog.btrim(COALESCE(v_payout, '')));
  IF v_payout = '' THEN
    RETURN 'NGN';
  END IF;
  RETURN v_payout;
END;
$$;

-- Helper for the SECURITY DEFINER loyalty RPCs only (definer's rights),
-- never direct session callers.
REVOKE ALL ON FUNCTION public.merchant_resolved_currency(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merchant_resolved_currency(uuid)
  TO service_role;
