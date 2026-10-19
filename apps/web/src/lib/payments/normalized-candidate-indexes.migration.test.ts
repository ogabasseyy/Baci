import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928184100_normalized_candidate_indexes.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('normalized candidate index migration', () => {
  it.each([
    [
      'paystack_abandoned_attempt_candidates_idx',
      'paystack_abandoned_attempt_candidates_normalized_idx',
    ],
    [
      'paystack_pending_cancellation_refunds_idx',
      'paystack_pending_cancellation_refunds_normalized_idx',
    ],
    [
      'paystack_completed_cancellation_refund_recheck_idx',
      'paystack_completed_cancellation_refund_recheck_normalized_idx',
    ],
  ])('replaces %s with a normalized-predicate equivalent', (oldName, newName) => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      `DROP INDEX CONCURRENTLY IF EXISTS ${oldName}`
    );
    expect(migrationSql).toContain(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${newName}`
    );
  });

  it('keys every replacement on the normalized gateway', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // PostgreSQL can only use a partial index when the query implies
    // its predicate: the candidate RPCs match on the helper, so the
    // indexes must too — an exact `gateway = 'paystack'` predicate
    // would never apply.
    expect(
      migrationSql.split(
        "public.normalized_gateway_name_v1(gateway) = 'PAYSTACK'"
      ).length - 1
    ).toBe(3);
    expect(migrationSql).not.toContain("AND gateway = 'paystack'");
  });
});
