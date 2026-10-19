import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928175000_partial_capture_short_review_type.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('partial capture short review type migration', () => {
  it('registers the short-capture review type with per-transfer dedup', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain("'partial_capture_short_requires_review'");
    // One captured transfer files its own row: without the exclusion a
    // second short capture on the same order would collide per order and
    // its evidence would be lost to the redelivery-as-success path.
    expect(migrationSql).toContain('reconciliation_review_open_by_order_idx');
    expect(migrationSql).toContain(
      "'merchant_invoice_partial_payment_conflict', 'partial_capture_short_requires_review'"
    );
  });
});
