-- PiggyVest legacy migration, step 1: the coordinator's balance list.
-- READ ONLY. Run by the owner against the production database, never by an agent.
--   psql "$DATABASE_URL" -f 01-balance-list.sql
-- Output: one row per old in-app wallet that still holds money.
-- Save the output as the coordinator list. Do not edit it by hand.
-- Only rows with eligible = true may go on the signed list.
BEGIN READ ONLY;

WITH ledger AS (
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
    count(*) FILTER (WHERE cwt.status = 'pending') AS pending_count
  FROM public.customer_wallet_transactions cwt
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
    AND cw.available_balance <= 99999999.99) AS eligible,
  -- 02-zero-out.sql rejects amounts above 99,999,999.99. Such a wallet is
  -- never eligible: raise it with the owner, do not credit it in PiggyVest.
  (cw.available_balance > 99999999.99) AS over_zero_out_limit,
  cw.updated_at
FROM public.customer_wallets cw
LEFT JOIN public.customers c
  ON c.id = cw.customer_id AND c.merchant_id = cw.merchant_id
LEFT JOIN ledger l
  ON l.wallet_id = cw.id
WHERE cw.available_balance > 0
ORDER BY cw.merchant_id, cw.available_balance DESC, cw.id;

ROLLBACK;
