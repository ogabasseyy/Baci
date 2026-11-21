import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LEGACY_MIGRATED_WALLET_STATEMENTS } from './legacy-migrated-wallet-statements';

const migration = readFileSync(
  new URL(
    '../../../../../supabase/migrations/20261121061500_piggyvest_migrated_legacy_wallet_balances.sql',
    import.meta.url
  ),
  'utf8'
);

describe('LEGACY_MIGRATED_WALLET_STATEMENTS', () => {
  it('pins the exact evidence query', () => {
    expect(LEGACY_MIGRATED_WALLET_STATEMENTS.readBalances).toBe(
      'SELECT piggyvest_primary.read_migrated_legacy_wallet_balances($1::uuid,$2::text,$3::jsonb) AS result'
    );
  });

  it('matches the function signature and grant the migration creates', () => {
    expect(migration).toMatch(
      /CREATE FUNCTION piggyvest_primary\.read_migrated_legacy_wallet_balances\(\s*integration_id uuid, environment text, options jsonb\)/
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION piggyvest_primary.read_migrated_legacy_wallet_balances(uuid, text, jsonb)\n  TO piggyvest_primary_evidence;'
    );
  });
});
