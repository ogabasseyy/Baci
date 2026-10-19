-- NGN-resolution helper for loyalty store_credit (issue #3165).
--
-- Customer wallets are an NGN-denominated ledger with no currency column:
-- the orders route and storefront checkout both skip wallet redemption
-- off-NGN, so a store_credit reward for a non-NGN merchant would burn
-- points for unusable credit. This mirrors resolveMerchantCurrencyConfig
-- (payout_currency -> country -> NGN platform default) and answers
-- whether a merchant resolves to NGN. Country coverage mirrors
-- MERCHANT_COUNTRIES (codes and names; only Nigeria maps to NGN), and
-- unknown values fall through to the NGN default exactly like the TS
-- resolver. The redeem RPC rejects and the status RPC hides store_credit
-- for merchants where this is false.
CREATE OR REPLACE FUNCTION public.merchant_resolves_to_ngn(p_merchant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_payout text;
  v_country text;
BEGIN
  SELECT m.payout_currency, m.country
  INTO v_payout, v_country
  FROM public.merchants AS m
  WHERE m.id = p_merchant_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- A valid payout code decides (trimmed, uppercased, ISO alpha-3).
  v_payout := pg_catalog.upper(pg_catalog.btrim(COALESCE(v_payout, '')));
  IF v_payout ~ '^[A-Z]{3}$' THEN
    RETURN v_payout = 'NGN';
  END IF;

  -- Otherwise the country decides; NULL and unlisted values fall through
  -- to the platform NGN default. Only Nigeria resolves to NGN.
  IF v_country IS NULL THEN
    RETURN true;
  END IF;
  IF pg_catalog.upper(v_country) IN (
       'AE', 'AU', 'BF', 'BR', 'CA', 'CI', 'CM', 'DE', 'EG', 'FR',
       'GB', 'GH', 'IN', 'JP', 'KE', 'RW', 'SN', 'TZ', 'UG', 'US', 'ZA'
     )
     OR pg_catalog.lower(v_country) IN (
       'australia', 'brazil', 'burkina faso', 'cameroon', 'canada',
       'côte d''ivoire', 'egypt', 'france', 'germany', 'ghana', 'india',
       'japan', 'kenya', 'rwanda', 'senegal', 'south africa', 'tanzania',
       'uganda', 'united arab emirates', 'united kingdom', 'united states'
     ) THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.merchant_resolves_to_ngn(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merchant_resolves_to_ngn(uuid)
  TO service_role;
