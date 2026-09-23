-- Support merchant-scoped lookups across all funding-request statuses, not only
-- the pending unique partial index.

CREATE INDEX IF NOT EXISTS merchant_wallet_funding_requests_merchant_id_idx
  ON public.merchant_wallet_funding_account_requests (merchant_id);
