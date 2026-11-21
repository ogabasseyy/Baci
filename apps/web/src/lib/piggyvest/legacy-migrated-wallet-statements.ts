/** Evidence-login read of moved legacy wallets that hold money again. */
export const LEGACY_MIGRATED_WALLET_STATEMENTS = {
  readBalances:
    'SELECT piggyvest_primary.read_migrated_legacy_wallet_balances($1::uuid,$2::text,$3::jsonb) AS result',
} as const;
