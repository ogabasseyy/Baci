import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const gateMigrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928184600_cancel_gate_ignores_reviewed_abandoned_attempts.sql'
);
const indexMigrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928184500_missing_ref_candidate_and_watch_sweep_indexes.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('cancel gate reviewed-attempt migration', () => {
  it('carves stamped attempts out of the in-flight cancellation block', () => {
    expect(existsSync(gateMigrationPath)).toBe(true);
    if (!existsSync(gateMigrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(gateMigrationPath, 'utf8'));

    // The sweep excludes stamped rows with this exact predicate; the
    // gate must match it or a reviewed capture blocks its order
    // permanently — never reselected, yet failing every
    // cancellation.
    expect(migrationSql).toContain(
      "AND t.metadata->'abandoned_sweep_resolution' IS NULL"
    );
    // The genuine in-flight block stays: unstamped pending and
    // processing legs still reject cancellation.
    expect(migrationSql).toContain("t.status IN ('pending', 'processing')");
    expect(migrationSql).toContain('payment_capture_in_flight');
    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.cancel_order_as_merchant('
    );
  });
});

describe('missing-ref candidate and watch sweep index migration', () => {
  it('covers the missing-reference branch the normalized index cannot serve', () => {
    expect(existsSync(indexMigrationPath)).toBe(true);
    if (!existsSync(indexMigrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(indexMigrationPath, 'utf8'));

    // The normalized candidate index requires gateway_reference IS
    // NOT NULL, so the missing-reference branch needs its own
    // partial index with the nullness flipped (same keys, same
    // remaining predicates).
    expect(migrationSql).toContain(
      'paystack_abandoned_missing_ref_candidates_idx'
    );
    expect(migrationSql).toContain('gateway_reference IS NULL');
    expect(migrationSql).toContain('updated_at ASC NULLS FIRST, id');
  });

  it('indexes the open-watch sweep by its rotation column', () => {
    expect(existsSync(indexMigrationPath)).toBe(true);
    if (!existsSync(indexMigrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(indexMigrationPath, 'utf8'));

    // The sweep orders open watches by updated_at (the touch column
    // its rotation bumps); the created_at sweep index cannot serve
    // that ordering.
    expect(migrationSql).toContain(
      'paystack_refund_recovery_watch_open_updated_idx'
    );
    expect(migrationSql).toContain("WHERE status = 'open'");
  });
});
