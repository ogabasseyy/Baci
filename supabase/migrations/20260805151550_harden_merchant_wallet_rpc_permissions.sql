-- Wallet summaries are financial reads. Only merchant owners or staff with the
-- established analytics:view grant may read them; only owners may initialize a
-- wallet. This keeps SECURITY DEFINER RPCs no broader than their callers.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_or_create_merchant_wallet(
  p_merchant_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallet_id uuid;
BEGIN
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id_required' USING ERRCODE = '22023';
  END IF;

  IF COALESCE((SELECT auth.role()), '') <> 'service_role'
    AND NOT EXISTS (
      SELECT 1
      FROM public.merchants AS merchant
      WHERE merchant.id = p_merchant_id
        AND merchant.user_id = (SELECT auth.uid())
    ) THEN
    RAISE EXCEPTION 'merchant_owner_required' USING ERRCODE = '42501';
  END IF;

  SELECT wallet.id
    INTO v_wallet_id
  FROM public.merchant_wallets AS wallet
  WHERE wallet.merchant_id = p_merchant_id
  FOR UPDATE;

  IF v_wallet_id IS NULL THEN
    INSERT INTO public.merchant_wallets (
      merchant_id,
      available_balance,
      pending_balance
    ) VALUES (p_merchant_id, 0, 0)
    ON CONFLICT (merchant_id) DO NOTHING
    RETURNING id INTO v_wallet_id;

    IF v_wallet_id IS NULL THEN
      SELECT wallet.id
        INTO v_wallet_id
      FROM public.merchant_wallets AS wallet
      WHERE wallet.merchant_id = p_merchant_id;
    END IF;
  END IF;

  RETURN v_wallet_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_wallet_summary(
  p_merchant_id uuid
) RETURNS TABLE(
  wallet_id uuid,
  available_balance numeric,
  pending_balance numeric,
  upcoming_balance numeric,
  upcoming_count integer,
  total_earned numeric,
  total_withdrawn numeric,
  can_withdraw boolean,
  next_settlement_date date,
  next_settlement_amount numeric
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
    ) AS next_settlement_amount
  FROM public.merchant_wallets AS wallet
  WHERE wallet.merchant_id = p_merchant_id;
END;
$$;

ALTER FUNCTION public.get_or_create_merchant_wallet(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_wallet_summary(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_or_create_merchant_wallet(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_wallet_summary(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_merchant_wallet(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_wallet_summary(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_or_create_merchant_wallet(uuid) IS
  'Creates or returns a merchant wallet only for its owner or the service role.';
COMMENT ON FUNCTION public.get_wallet_summary(uuid) IS
  'Returns a merchant wallet summary only to its owner, analytics:view staff, or the service role.';

COMMIT;
