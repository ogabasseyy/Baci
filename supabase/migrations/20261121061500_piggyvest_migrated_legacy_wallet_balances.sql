-- Daily alert: legacy wallets already moved to PiggyVest that hold money again.
--
-- The S10 runbook (docs/piggyvest-legacy-migration-runbook.md) moves a
-- customer's old in-app store credit to PiggyVest by hand: the owner credits
-- the customer at PiggyVest, then 02-zero-out.sql empties the legacy wallet
-- and writes one 'piggyvest_legacy_migration' ledger row. A late credit (for
-- example a refund that was already on its way) can land on that wallet after
-- it was emptied. The runbook's one-hour re-check catches this by hand; this
-- read lets the daily PiggyVest reconciliation catch it every day.
--
-- READ ONLY. It returns wallet ids and amounts, never names, emails or phone
-- numbers, and it never moves money: a wallet listed here is resolved by hand
-- (never credit PiggyVest a second time, see the runbook).
--
-- Scope: only the merchant that owns the calling PiggyVest integration
-- (PiggyVest is Ogabassey-only). Callable only by the reconciliation evidence
-- login, through the same authority check as the wallet pay reconciliation.
BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('piggyvest_primary.assert_wallet_pay_evidence(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'wallet pay evidence check missing; apply 20261112161500 first';
  END IF;
END $guard$;

-- options is unused; it keeps the evidence executor's (uuid, text, jsonb) shape.
CREATE FUNCTION piggyvest_primary.read_migrated_legacy_wallet_balances(
  integration_id uuid, environment text, options jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding piggyvest_primary.integrations%ROWTYPE;
BEGIN
  v_binding := piggyvest_primary.assert_wallet_pay_evidence(
    read_migrated_legacy_wallet_balances.integration_id,
    read_migrated_legacy_wallet_balances.environment);
  RETURN (
    WITH flagged AS (
      SELECT wallet.id, wallet.available_balance
        FROM public.customer_wallets AS wallet
       WHERE wallet.merchant_id = v_binding.merchant_id
         AND wallet.available_balance > 0
         AND EXISTS (
           SELECT 1 FROM public.customer_wallet_transactions AS moved
            WHERE moved.wallet_id = wallet.id
              AND moved.source_type = 'piggyvest_legacy_migration')
    )
    SELECT pg_catalog.jsonb_build_object(
      'count', (SELECT pg_catalog.count(*) FROM flagged),
      'totalBalance', (SELECT COALESCE(pg_catalog.sum(flagged.available_balance), 0)::numeric(14,2)::text FROM flagged),
      'wallets', COALESCE((SELECT pg_catalog.jsonb_agg(item) FROM (
          SELECT pg_catalog.jsonb_build_object(
                   'walletId', flagged.id,
                   'balance', flagged.available_balance::text) AS item
            FROM flagged
           ORDER BY flagged.available_balance DESC, flagged.id
           LIMIT 50) AS listed), '[]'::jsonb))
  );
END;
$$;

REVOKE ALL ON FUNCTION piggyvest_primary.read_migrated_legacy_wallet_balances(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_migrated_legacy_wallet_balances(uuid, text, jsonb)
  TO piggyvest_primary_evidence;

COMMIT;
