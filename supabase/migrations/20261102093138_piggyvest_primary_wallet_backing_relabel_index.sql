-- disable-transaction
-- Follow-up to 20261102093136_piggyvest_primary_wallet_backing: at most one
-- legacy-out (-X) and one PiggyVest-in (+X) relabel row per backing row,
-- whatever writes them. The index stays empty until a wallet flips.
-- customer_wallet_transactions is the live wallet ledger, so the index is
-- built concurrently: a plain build would block every ledger write for the
-- whole table scan. Production deploys split this marked migration into
-- top-level statements. The drop clears a leftover INVALID index from an
-- interrupted concurrent build so the CREATE rebuilds instead of skipping on
-- the name (same pattern as 20261007120000); a plain CREATE fails loudly if
-- two deploys race.
DROP INDEX CONCURRENTLY IF EXISTS public.customer_wallet_transactions_legacy_migration_once;

CREATE UNIQUE INDEX CONCURRENTLY customer_wallet_transactions_legacy_migration_once
  ON public.customer_wallet_transactions (source_id, (amount > 0))
  WHERE source_type = 'piggyvest_legacy_migration';

COMMENT ON INDEX public.customer_wallet_transactions_legacy_migration_once IS
  'One legacy-out and one PiggyVest-in relabel row per PiggyVest wallet backing row.';
