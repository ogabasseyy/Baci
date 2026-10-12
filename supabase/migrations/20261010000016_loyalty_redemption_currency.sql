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

-- Mirror of resolveMerchantCurrencyConfig (payout -> country -> NGN):
-- a valid ISO payout code decides, else the MERCHANT_COUNTRIES currency
-- for the merchant's country (code or name), else the NGN default.
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
  v_country text;
BEGIN
  SELECT m.payout_currency, m.country
  INTO v_payout, v_country
  FROM public.merchants AS m
  WHERE m.id = p_merchant_id;
  IF NOT FOUND THEN
    RETURN 'NGN';
  END IF;

  v_payout := pg_catalog.upper(pg_catalog.btrim(COALESCE(v_payout, '')));
  IF v_payout ~ '^[A-Z]{3}$' THEN
    RETURN v_payout;
  END IF;

  RETURN COALESCE(
    CASE pg_catalog.upper(pg_catalog.btrim(COALESCE(v_country, '')))
      WHEN 'AE' THEN 'AED' WHEN 'AU' THEN 'AUD' WHEN 'BF' THEN 'XOF'
      WHEN 'BR' THEN 'BRL' WHEN 'CA' THEN 'CAD' WHEN 'CI' THEN 'XOF'
      WHEN 'CM' THEN 'XAF' WHEN 'DE' THEN 'EUR' WHEN 'EG' THEN 'EGP'
      WHEN 'FR' THEN 'EUR' WHEN 'GB' THEN 'GBP' WHEN 'GH' THEN 'GHS'
      WHEN 'IN' THEN 'INR' WHEN 'JP' THEN 'JPY' WHEN 'KE' THEN 'KES'
      WHEN 'NG' THEN 'NGN' WHEN 'RW' THEN 'RWF' WHEN 'SN' THEN 'XOF'
      WHEN 'TZ' THEN 'TZS' WHEN 'UG' THEN 'UGX' WHEN 'US' THEN 'USD'
      WHEN 'ZA' THEN 'ZAR'
    END,
    CASE pg_catalog.lower(pg_catalog.btrim(COALESCE(v_country, '')))
      WHEN 'australia' THEN 'AUD' WHEN 'brazil' THEN 'BRL'
      WHEN 'burkina faso' THEN 'XOF' WHEN 'cameroon' THEN 'XAF'
      WHEN 'canada' THEN 'CAD' WHEN 'côte d''ivoire' THEN 'XOF'
      WHEN 'egypt' THEN 'EGP' WHEN 'france' THEN 'EUR'
      WHEN 'germany' THEN 'EUR' WHEN 'ghana' THEN 'GHS'
      WHEN 'india' THEN 'INR' WHEN 'japan' THEN 'JPY'
      WHEN 'kenya' THEN 'KES' WHEN 'nigeria' THEN 'NGN'
      WHEN 'rwanda' THEN 'RWF' WHEN 'senegal' THEN 'XOF'
      WHEN 'south africa' THEN 'ZAR' WHEN 'tanzania' THEN 'TZS'
      WHEN 'uganda' THEN 'UGX' WHEN 'united arab emirates' THEN 'AED'
      WHEN 'united kingdom' THEN 'GBP' WHEN 'united states' THEN 'USD'
    END,
    'NGN'
  );
END;
$$;

-- Helper for the SECURITY DEFINER loyalty RPCs only (definer's rights),
-- never direct session callers.
REVOKE ALL ON FUNCTION public.merchant_resolved_currency(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merchant_resolved_currency(uuid)
  TO service_role;
