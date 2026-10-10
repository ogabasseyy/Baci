import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928183800_claim_refund_notifications_attempt_order.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('refund notification claim ordering migration', () => {
  it('claims never-attempted rows before rotating retries', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'ORDER BY attempts ASC, claimed_at ASC NULLS FIRST, created_at'
    );
  });

  it('no longer orders the claim queue by creation time alone', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // The exhaustion terminalization sweep keeps its created_at order
    // (it flips state, not send order); the claim candidate query must
    // not select by creation time alone.
    expect(migrationSql).not.toContain('ORDER BY created_at LIMIT greatest');
  });
});
