import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928174000_stamp_abandoned_sweep_resolution_any_gateway.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('stamp abandoned sweep resolution any gateway migration', () => {
  it('stamps verified captures without the Paystack gateway guard', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE FUNCTION public.stamp_abandoned_sweep_resolution_any_gateway_v1('
    );
    // The id plus expected reference identifies the row exactly; the
    // gateway guard is dropped so Korapay/Juicyway captures retire.
    expect(migrationSql).not.toContain("gateway = 'paystack'");
    expect(migrationSql).toContain('gateway_reference = p_expected_reference');
    expect(migrationSql).toContain("status IN ('pending', 'processing')");
    expect(migrationSql).toContain(
      "'abandoned_sweep_resolution', p_resolution"
    );
    expect(migrationSql).toContain(
      "(SELECT auth.role()) IS DISTINCT FROM 'service_role'"
    );
    expect(migrationSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.stamp_abandoned_sweep_resolution_any_gateway_v1(uuid, text, text)'
    );
  });
});
