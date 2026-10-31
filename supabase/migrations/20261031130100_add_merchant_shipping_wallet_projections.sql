-- Fulfil-staff GIG merchant-wallet access, part 2 of 6.
-- Concern: narrow wallet balance and funding-account reads.
-- The owner decision and gate rules are documented in
-- 20261031130000_add_gigl_wallet_actor_columns.sql.

-- 1. Narrow balance read for the GIG preview, bound-quote reuse, the mobile
--    wallet poll and the insufficient-balance details. One number only.
CREATE OR REPLACE FUNCTION public.get_merchant_shipping_wallet_balance(
  p_merchant_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id_required' USING ERRCODE = '22023';
  END IF;
  IF (SELECT auth.uid()) IS NULL OR NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'orders', 'fulfill'
  ) THEN
    RAISE EXCEPTION 'merchant_shipping_wallet_balance_forbidden'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(
    (
      SELECT wallet.available_balance
      FROM public.merchant_wallets AS wallet
      WHERE wallet.merchant_id = p_merchant_id
    ),
    0
  );
END;
$$;

ALTER FUNCTION public.get_merchant_shipping_wallet_balance(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_merchant_shipping_wallet_balance(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_merchant_shipping_wallet_balance(uuid)
  TO authenticated;

-- 2. Safe funding-account projection. The table policy stays owner-only so
--    staff never read provider_account_id, provider_customer_code or metadata.
CREATE OR REPLACE FUNCTION public.get_merchant_wallet_funding_account(
  p_merchant_id uuid
)
RETURNS TABLE (
  account_name text,
  account_number text,
  bank_name text,
  currency text,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id_required' USING ERRCODE = '22023';
  END IF;
  IF (SELECT auth.uid()) IS NULL OR NOT public.check_staff_permission(
    (SELECT auth.uid()), p_merchant_id, 'orders', 'fulfill'
  ) THEN
    RAISE EXCEPTION 'merchant_wallet_funding_account_forbidden'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    account.account_name,
    account.account_number,
    account.bank_name,
    account.currency,
    account.status
  FROM public.merchant_wallet_payment_accounts AS account
  WHERE account.merchant_id = p_merchant_id
    AND account.status IN ('active', 'pending')
  ORDER BY account.created_at, account.id;
END;
$$;

ALTER FUNCTION public.get_merchant_wallet_funding_account(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_merchant_wallet_funding_account(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_merchant_wallet_funding_account(uuid)
  TO authenticated;
