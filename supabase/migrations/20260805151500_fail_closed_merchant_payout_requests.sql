-- Manual withdrawals are unavailable until an atomic reservation and provider
-- reconciliation path exists. The database must therefore reject direct writes.

BEGIN;

DROP POLICY IF EXISTS "Merchants can create their own payout requests"
  ON public.payout_requests;
DROP POLICY IF EXISTS "Merchants can view their own payout requests"
  ON public.payout_requests;

CREATE POLICY "Merchants can view their own payout requests"
  ON public.payout_requests
  FOR SELECT
  TO authenticated
  USING (
    merchant_id IN (
      SELECT merchant.id
      FROM public.merchants AS merchant
      WHERE merchant.user_id = (SELECT auth.uid())
    )
  );

REVOKE ALL ON TABLE public.payout_requests
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.payout_requests TO authenticated;

-- Service-role workers retain the existing trusted settlement capability. This
-- migration adds no payout, debit, fulfillment, or provider execution path.
GRANT ALL ON TABLE public.payout_requests TO service_role;

DROP POLICY IF EXISTS "Merchants can update their wallet settings"
  ON public.merchant_wallets;
DROP POLICY IF EXISTS "Merchants can view their own wallet"
  ON public.merchant_wallets;

CREATE POLICY "Merchants can view their own wallet"
  ON public.merchant_wallets
  FOR SELECT
  TO authenticated
  USING (
    merchant_id IN (
      SELECT merchant.id
      FROM public.merchants AS merchant
      WHERE merchant.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Merchants can update their wallet settings"
  ON public.merchant_wallets
  FOR UPDATE
  TO authenticated
  USING (
    merchant_id IN (
      SELECT merchant.id
      FROM public.merchants AS merchant
      WHERE merchant.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    merchant_id IN (
      SELECT merchant.id
      FROM public.merchants AS merchant
      WHERE merchant.user_id = (SELECT auth.uid())
    )
    AND min_payout_amount BETWEEN 1000 AND 10000000
  );

REVOKE ALL ON TABLE public.merchant_wallets
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.merchant_wallets TO authenticated;
GRANT UPDATE (auto_payout_enabled, auto_payout_day, min_payout_amount)
  ON TABLE public.merchant_wallets TO authenticated;

-- Trusted settlement RPCs and the VPS payout worker retain their service role
-- access. Authenticated users cannot mutate balances, identities, or timestamps.
GRANT ALL ON TABLE public.merchant_wallets TO service_role;

COMMENT ON TABLE public.payout_requests IS
  'Payout history is merchant-readable; direct merchant mutation is disabled until the trusted payout worker is available.';
COMMENT ON TABLE public.merchant_wallets IS
  'Merchant balance ledger. Authenticated merchants may update only payout settings.';

COMMIT;
