import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260927151300_reject_settlement_for_cancelled_orders.sql'
);

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('record_merchant_settlement cancelled-order guard', () => {
  it('locks the order row and rejects cancelled or refunded orders', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const migrationSql = normalizeSql(readFileSync(migrationPath, 'utf8'));

    expect(migrationSql).toContain(
      "IF p_source_type = 'order' AND p_source_id IS NOT NULL THEN"
    );
    expect(migrationSql).toContain(
      'FROM public.orders AS o WHERE o.id = p_source_id FOR UPDATE'
    );
    expect(migrationSql).toContain(
      "v_order_shipping_status IN ('cancelled', 'canceled') OR v_order_payment_status = 'refunded'"
    );
    expect(migrationSql).toContain(
      "RAISE EXCEPTION 'settlement_order_cancelled'"
    );
  });
});
