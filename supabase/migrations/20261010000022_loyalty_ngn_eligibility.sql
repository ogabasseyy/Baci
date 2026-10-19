-- Store-credit eligibility follows the order-stamping rule (issue #3165).
--
-- merchant_resolves_to_ngn (migration 20261010000013) mirrored the
-- DISPLAY resolver (payout -> country -> NGN): a foreign-country
-- merchant whose payout currency still resolves to NGN therefore lost
-- store-credit eligibility even though private.create_storefront_order
-- stamps such orders NGN (the payout-only rule merchant_resolved_currency
-- encodes) and the wallet path accepts them. Redefine eligibility on
-- that rule; redeem rejects and the status catalog hides store_credit
-- exactly when the merchant's orders would not be NGN.
CREATE OR REPLACE FUNCTION public.merchant_resolves_to_ngn(p_merchant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT public.merchant_resolved_currency(p_merchant_id) = 'NGN';
$$;
