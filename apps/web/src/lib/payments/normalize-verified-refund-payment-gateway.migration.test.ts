import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928183700_normalize_verified_refund_payment_gateway.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('verified refund payment gateway normalization migration', () => {
  it('matches the linked payment with a normalized gateway comparison', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      "public.normalized_gateway_name_v1(gateway) = 'PAYSTACK'"
    );
    expect(migrationSql).toContain(
      'public.normalized_gateway_name_v1(r.gateway) = public.normalized_gateway_name_v1(p.gateway)'
    );
  });

  it('keeps no exact gateway match on the linked payment lookup', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    // The refund-row lookup keeps its exact match (refund rows are
    // written by this feature); only the linked payment lookup — a
    // legacy row the feature never wrote — must normalize.
    expect(migrationSql).not.toContain(
      "transaction_type = 'payment' AND gateway = 'paystack'"
    );
    expect(migrationSql).toContain(
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
