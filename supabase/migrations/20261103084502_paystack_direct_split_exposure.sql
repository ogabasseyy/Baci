-- Paystack direct-split settlement history, part 3 of 5: exposure and the
-- spendable balance. See 20261103084500_paystack_direct_split_settlement_history.sql.

-- Settled Paystack order settlements that credited the wallet without proof
-- that Baci's own Paystack balance received the money. New Baci-collected
-- Paystack credits carry paystack_collection = 'integration' (set by the
-- executor from the verified payload); the owner's reconciliation marks
-- reviewed legacy rows legacy_wallet_credit_reconciled = true.
CREATE OR REPLACE FUNCTION private.merchant_wallet_direct_settled_exposure(
  p_wallet_id uuid
) RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(SUM(GREATEST(COALESCE(settlement.net_amount, 0), 0)), 0)
    FROM public.merchant_settlements AS settlement
   WHERE settlement.wallet_id = p_wallet_id
     AND settlement.status = 'settled'
     AND settlement.source_type = 'order'
     AND pg_catalog.lower(pg_catalog.btrim(COALESCE(settlement.gateway, ''))) = 'paystack'
     AND NOT private.is_direct_split_settlement(settlement.metadata)
     AND COALESCE(settlement.metadata ->> 'paystack_collection', '') <> 'integration'
     AND COALESCE(settlement.metadata ->> 'legacy_wallet_credit_reconciled', 'false') <> 'true'
$$;
ALTER FUNCTION private.merchant_wallet_direct_settled_exposure(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.merchant_wallet_direct_settled_exposure(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- No new index: the exposure sum filters by wallet_id, which the baseline's
-- idx_merchant_settlements_wallet_id already covers, and a plain CREATE INDEX
-- here would hold a SHARE lock on merchant_settlements during deploy.

-- Spendable balance for payout callers and dashboards (service_role only).
CREATE OR REPLACE FUNCTION public.get_merchant_wallet_spendable_balance(
  p_merchant_id uuid
) RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallet public.merchant_wallets%ROWTYPE;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden: get_merchant_wallet_spendable_balance requires service_role'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_wallet FROM public.merchant_wallets WHERE merchant_id = p_merchant_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  RETURN GREATEST(
    COALESCE(v_wallet.available_balance, 0)
      - private.merchant_wallet_direct_settled_exposure(v_wallet.id),
    0
  );
END;
$$;
ALTER FUNCTION public.get_merchant_wallet_spendable_balance(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_merchant_wallet_spendable_balance(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_merchant_wallet_spendable_balance(uuid)
  TO service_role;

