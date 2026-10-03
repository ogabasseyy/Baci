import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928183900_normalize_abandoned_sweep_rpc_gateways.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('abandoned sweep RPC gateway normalization migration', () => {
  it('normalizes the stamp and mismatch-merge gateway guards', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.stamp_abandoned_sweep_resolution_v1('
    );
    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.merge_abandoned_attempt_evidence_mismatch_v1('
    );
    expect(migrationSql).toContain(
      "public.normalized_gateway_name_v1(gateway) = 'PAYSTACK'"
    );
  });

  it('normalizes both sides of the duplicate-merge gateway guard', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.merge_duplicate_payment_capture_evidence_v1('
    );
    expect(migrationSql).toContain(
      'public.normalized_gateway_name_v1(gateway) = public.normalized_gateway_name_v1(p_gateway)'
    );
  });

  it('keeps no exact gateway match in the sweep write guards', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).not.toContain("AND gateway = 'paystack'");
    expect(migrationSql).not.toContain('AND gateway = p_gateway');
  });
});
