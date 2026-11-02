import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = path.resolve(
  import.meta.dirname,
  '../../../../supabase/migrations'
);

function migrationNamed(suffix: string): string {
  const matches = readdirSync(MIGRATIONS_DIR).filter((name) =>
    new RegExp(`^\\d{14}_${suffix}\\.sql$`).test(name)
  );
  expect(matches).toHaveLength(1);
  return readFileSync(path.join(MIGRATIONS_DIR, matches[0] ?? ''), 'utf8');
}

describe('PiggyVest wallet backing relabel index migration', () => {
  it('builds the ledger index concurrently, outside a transaction', () => {
    // Arrange & Act
    const migration = migrationNamed(
      'piggyvest_primary_wallet_backing_relabel_index'
    );

    // Assert: a plain build would block customer_wallet_transactions writes
    // for the whole scan.
    expect(migration.split('\n')[0]).toBe('-- disable-transaction');
    expect(migration).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
    expect(migration).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS public.customer_wallet_transactions_legacy_migration_once;'
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX CONCURRENTLY customer_wallet_transactions_legacy_migration_once\s+ON public\.customer_wallet_transactions \(source_id, \(amount > 0\)\)\s+WHERE source_type = 'piggyvest_legacy_migration';/
    );
  });

  it('keeps the transactional backing migration free of ledger index builds', () => {
    // Arrange & Act
    const migration = migrationNamed('piggyvest_primary_wallet_backing');

    // Assert
    expect(migration).not.toMatch(
      /CREATE\s+(UNIQUE\s+)?INDEX[^;]*ON\s+public\.customer_wallet_transactions/i
    );
  });
});
