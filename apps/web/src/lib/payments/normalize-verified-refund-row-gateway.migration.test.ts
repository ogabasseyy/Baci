import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928184300_normalize_verified_refund_row_gateway.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('verified refund row gateway normalization migration', () => {
  it('matches the refund row with a normalized gateway comparison', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // Candidate selection deliberately returns legacy refund rows
    // whose gateway is `Paystack` or padded: an exact match here
    // would raise refund_not_found on verified evidence, which the
    // pending worker holds out of polling.
    expect(migrationSql).toContain(
      "public.normalized_gateway_name_v1(gateway) = 'PAYSTACK'"
    );
    expect(migrationSql).not.toContain(
      "transaction_type = 'refund' AND gateway = 'paystack'"
    );
  });

  it('stays within the file modularity limit', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const lineCount = readFileSync(migrationPath, 'utf8').split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(300);
  });
});
