-- Project payout settings through the permission-checked wallet summary RPC so
-- analytics staff do not need a direct merchant_wallets SELECT grant.
BEGIN;

DROP FUNCTION IF EXISTS public.get_wallet_summary(uuid);
CREATE FUNCTION public.get_wallet_summary(
  p_merchant_id uuid
)
RETURNS TABLE(
  wallet_id uuid,
  available_balance numeric,
  pending_balance numeric,
  upcoming_balance numeric,
  upcoming_count integer,
  total_earned numeric,
  total_withdrawn numeric,
  can_withdraw boolean,
  next_settlement_date date,
  next_settlement_amount numeric,
  auto_payout_enabled boolean,
  auto_payout_day text,
  min_payout_amount numeric,
  last_payout_at timestamptz,
  last_payout_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id_required' USING ERRCODE = '22023';
  END IF;

  IF COALESCE((SELECT auth.role()), '') <> 'service_role'
    AND NOT public.check_staff_permission(
      (SELECT auth.uid()), p_merchant_id, 'analytics', 'view'
    ) THEN
    RAISE EXCEPTION 'merchant_wallet_read_required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    wallet.id,
    wallet.available_balance,
    wallet.pending_balance,
    wallet.upcoming_balance,
    wallet.upcoming_count,
    wallet.total_earned,
    wallet.total_withdrawn,
    wallet.available_balance >= 1000.00 AS can_withdraw,
    (
      SELECT MIN(settlement.expected_settlement_date)
      FROM public.merchant_settlements AS settlement
      WHERE settlement.merchant_id = p_merchant_id
        AND settlement.status = 'pending'
    ) AS next_settlement_date,
    (
      SELECT COALESCE(SUM(settlement.net_amount), 0)
      FROM public.merchant_settlements AS settlement
      WHERE settlement.merchant_id = p_merchant_id
        AND settlement.status = 'pending'
        AND settlement.expected_settlement_date = (
          SELECT MIN(next_settlement.expected_settlement_date)
          FROM public.merchant_settlements AS next_settlement
          WHERE next_settlement.merchant_id = p_merchant_id
            AND next_settlement.status = 'pending'
        )
    ) AS next_settlement_amount,
    wallet.auto_payout_enabled,
    wallet.auto_payout_day,
    wallet.min_payout_amount,
    wallet.last_payout_at,
    wallet.last_payout_amount
  FROM public.merchant_wallets AS wallet
  WHERE wallet.merchant_id = p_merchant_id;
END;
$$;

ALTER FUNCTION public.get_wallet_summary(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_wallet_summary(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_wallet_summary(uuid)
  TO authenticated, service_role;

COMMIT;
