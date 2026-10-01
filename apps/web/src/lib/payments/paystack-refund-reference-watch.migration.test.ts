import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928182500_paystack_refund_reference_watch.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('refund reference-watch migration', () => {
  it('allows one open reference watch per reference', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'ALTER COLUMN provider_refund_id DROP NOT NULL'
    );
    expect(migrationSql).toContain('paystack_refund_reference_watch_open_idx');
    expect(migrationSql).toContain(
      'WHERE provider_refund_id IS NULL AND status ='
    );
  });

  it('opens the reference watch and re-scans under the completion lock', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE FUNCTION public.open_paystack_refund_reference_watch_v1('
    );
    // Same reference key the completion path claims under: rows
    // returned mean the payment landed first, an empty set leaves the
    // watch open for the completion to claim.
    expect(migrationSql).toContain("'baci_paystack_refund_watch:'");
    expect(migrationSql).toContain(
      'CREATE FUNCTION public.resolve_paystack_refund_reference_watch_v1('
    );
    expect(migrationSql).toContain("status IN ('open', 'claimed')");
  });
});
