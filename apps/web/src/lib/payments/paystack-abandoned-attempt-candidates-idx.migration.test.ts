import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928182300_paystack_abandoned_attempt_candidates_idx_resolution.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('abandoned-candidate index resolution migration', () => {
  it('rebuilds the index excluding stamped attempts', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // Concurrent rebuild: the ledger stays writable while the index
    // swaps underneath the sweep.
    expect(migrationSql).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS public.paystack_abandoned_attempt_candidates_idx'
    );
    expect(migrationSql).toContain(
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS paystack_abandoned_attempt_candidates_idx'
    );
    // Mirrors the worker query's resolution filter exactly
    // (metadata->, not ->>): any spelling drift silently drops
    // index usage and the sweep degrades to a full scan.
    expect(migrationSql).toContain(
      "metadata->'abandoned_sweep_resolution' IS NULL"
    );
  });
});
