-- PiggyVest legacy migration, step 1: the coordinator's balance list.
-- READ ONLY. Run by the owner against the production database, never by an agent.
--   psql "$DATABASE_URL" -f 01-balance-list.sql
-- Output: one row per old in-app wallet that still holds money.
-- Save the output as the coordinator list. Do not edit it by hand.
-- Only rows with eligible = true may go on the signed list.
-- already_migrated = true means the wallet already has a migration ledger row:
-- the customer was paid in PiggyVest once. Such a row is never eligible, even
-- when a late credit lets the stored balance and the ledger agree again.
--
-- PRIVACY: this output holds names, emails and phone numbers. Keep it in one
-- restricted folder, share it only with the coordinator, never copy it into
-- email or chat, and delete every copy 30 days after step 5 is finished.
BEGIN READ ONLY;

WITH positive AS (
  -- Only wallets that can appear in the result are aggregated below.
  SELECT id FROM public.customer_wallets WHERE available_balance > 0
),
ledger AS (
  SELECT
    cwt.wallet_id,
    COALESCE(SUM(
      CASE
        WHEN cwt.status = 'completed'
          AND cwt.type IN ('credit', 'cashback', 'bonus', 'adjustment', 'refund')
          THEN cwt.amount
        WHEN cwt.status = 'completed'
          AND cwt.type IN ('debit', 'redemption', 'expiry')
          THEN -cwt.amount
        -- Same formula as public.backfill_wallet_balances(): an expired
        -- expiry row is a debit too.
        WHEN cwt.status = 'expired' AND cwt.type = 'expiry'
          THEN -cwt.amount
        ELSE 0
      END
    ), 0) AS ledger_balance,
    count(*) FILTER (WHERE cwt.status = 'pending') AS pending_count,
    bool_or(cwt.source_type = 'piggyvest_legacy_migration') AS migrated
  FROM public.customer_wallet_transactions cwt
  JOIN positive p ON p.id = cwt.wallet_id
  GROUP BY cwt.wallet_id
)
SELECT
  cw.id AS wallet_id,
  cw.merchant_id,
  cw.customer_id,
  c.full_name,
  c.email,
  c.phone,
  cw.available_balance AS legacy_balance,
  COALESCE(l.ledger_balance, 0) AS ledger_balance,
  (cw.available_balance IS NOT DISTINCT FROM COALESCE(l.ledger_balance, 0)) AS matches_ledger,
  COALESCE(l.pending_count, 0) AS pending_count,
  (cw.available_balance IS NOT DISTINCT FROM COALESCE(l.ledger_balance, 0)
    AND COALESCE(l.pending_count, 0) = 0
    AND NOT COALESCE(l.migrated, false)
    AND c.id IS NOT NULL
    AND cw.available_balance <= 99999999.99) AS eligible,
  -- 02-zero-out.sql rejects amounts above 99,999,999.99. Such a wallet is
  -- never eligible: raise it with the owner, do not credit it in PiggyVest.
  (cw.available_balance > 99999999.99) AS over_zero_out_limit,
  COALESCE(l.migrated, false) AS already_migrated,
  -- false = no customers row for this wallet's customer and merchant. Such a
  -- wallet is never eligible: nobody can be identified to credit.
  (c.id IS NOT NULL) AS customer_found,
  cw.updated_at
FROM public.customer_wallets cw
LEFT JOIN public.customers c
  ON c.id = cw.customer_id AND c.merchant_id = cw.merchant_id
LEFT JOIN ledger l
  ON l.wallet_id = cw.id
WHERE cw.available_balance > 0
ORDER BY cw.merchant_id, cw.available_balance DESC, cw.id;

ROLLBACK;
