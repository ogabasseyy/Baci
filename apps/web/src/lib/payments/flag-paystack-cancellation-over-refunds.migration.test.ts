import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260928172000_flag_paystack_cancellation_over_refunds.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('flag paystack cancellation over refunds migration', () => {
  it('files an unresolved review when refunds exceed a payment leg', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      'CREATE FUNCTION public.flag_paystack_cancellation_over_refunds_v1('
    );
    expect(migrationSql).toContain(
      'HAVING coalesce(sum(r.amount), 0) > p.amount'
    );
    expect(migrationSql).toContain(
      "'order_cancellation_over_refund_requires_review'"
    );
    // Concurrent finalizations must not duplicate the open review.
    expect(migrationSql).toContain('ON CONFLICT DO NOTHING');
  });

  it('wires the over-refund flag into the shared finalizer', () => {
    const finalizePath = resolve(
      __dirname,
      '../../../../../supabase/migrations/20260927150500_complete_legacy_paystack_cancellation_refunds.sql'
    );
    expect(existsSync(finalizePath)).toBe(true);
    if (!existsSync(finalizePath)) return;

    const finalizeSql = normalizeSql(readFileSync(finalizePath, 'utf8'));

    expect(finalizeSql).toContain(
      'PERFORM public.flag_paystack_cancellation_over_refunds_v1(p_order_id, p_merchant_id)'
    );
  });
});
