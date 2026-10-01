import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928183000_flag_over_refunds_completed_leg_only.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('over-refund completed-leg attribution migration', () => {
  it('attributes unlinked refunds to completed legs only', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE OR REPLACE FUNCTION public.flag_paystack_cancellation_over_refunds_v1('
    );
    // The fallback checked the count of completed legs but not that
    // the current leg is completed: a refund_pending leg with its own
    // linked coverage would also absorb the unrelated unlinked refund
    // and file a false over-refund review. Mirrors the claim gate.
    expect(migrationSql).toContain(
      "r.metadata->>'payment_transaction_id' IS NULL"
    );
    expect(migrationSql).toContain("AND p.status = 'completed' AND 1 = (");
  });
});
