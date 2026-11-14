-- Wallet screen: "Spendable" vs "Settled to your bank by Paystack".
-- Read-only projection. Same spendable rule as reserve_merchant_shipping_charge
-- (20261103084503): available_balance minus Paystack direct-split exposure.
-- settled_to_bank_total is history only (Paystack paid the merchant directly):
-- proven direct-split settlements. pending_reconciliation_total is the legacy
-- exposure held back from spending whose destination is not yet verified; it
-- is reported separately so it is never presented as confirmed bank receipts.
-- Authenticated-only by design (dashboard user client); unlike get_wallet_summary
-- it deliberately has no service_role path.
-- Neither is spendable or withdrawable. No balance is changed.
CREATE OR REPLACE FUNCTION public.get_merchant_wallet_spendable_breakdown(
  p_merchant_id uuid
)
RETURNS TABLE (
  spendable_balance numeric,
  settled_to_bank_total numeric,
  pending_reconciliation_total numeric
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
    (SELECT auth.uid()), p_merchant_id, 'analytics', 'view'
  ) THEN
    RAISE EXCEPTION 'merchant_wallet_read_required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    GREATEST(
      COALESCE(wallet.available_balance, 0)
        - private.merchant_wallet_direct_settled_exposure(wallet.id),
      0
    ),
    COALESCE((
      SELECT SUM(GREATEST(COALESCE(settlement.net_amount, 0), 0))
      FROM public.merchant_settlements AS settlement
      WHERE settlement.wallet_id = wallet.id
        AND settlement.status = 'settled'
        AND settlement.source_type = 'order'
        AND pg_catalog.lower(pg_catalog.btrim(COALESCE(settlement.gateway, ''))) = 'paystack'
        AND private.is_direct_split_settlement(settlement.metadata)
    ), 0),
    COALESCE(private.merchant_wallet_direct_settled_exposure(wallet.id), 0)
  FROM public.merchant_wallets AS wallet
  WHERE wallet.merchant_id = p_merchant_id;
END;
$$;

ALTER FUNCTION public.get_merchant_wallet_spendable_breakdown(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_merchant_wallet_spendable_breakdown(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_merchant_wallet_spendable_breakdown(uuid)
  TO authenticated;
