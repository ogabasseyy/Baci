import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260927151000_backfill_paystack_dva_placeholder_marker.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('paystack DVA placeholder backfill migration', () => {
  it('marks only transactions correlated with a DVA reservation', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      "t.transaction_type = 'payment' AND t.gateway = 'paystack'"
    );
    expect(migrationSql).toContain("t.status IN ('pending', 'processing')");
    expect(migrationSql).toContain(
      "coalesce(t.metadata->>'paystack_payment_type', '') IS DISTINCT FROM 'dva'"
    );
    expect(migrationSql).toContain(
      "a.order_id = t.order_id AND a.provider = 'paystack'"
    );
    expect(migrationSql).toContain('a.assigned_at IS NOT NULL');
    expect(migrationSql).toContain(
      't.created_at >= a.assigned_at - make_interval(mins => 2)'
    );
    expect(migrationSql).toContain(
      't.created_at <= a.assigned_at + make_interval(mins => 5)'
    );
  });
});
