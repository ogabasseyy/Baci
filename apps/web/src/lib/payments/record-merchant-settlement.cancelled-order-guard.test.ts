import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260927151300_reject_settlement_for_cancelled_orders.sql'
);
const directSplitMigrationPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260927151400_guard_direct_split_settlement_for_cancelled_orders.sql'
);
const giglWrapperPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260905113100_subtract_internal_credit_from_gigl_settlement_retention.sql'
);
const directSplitGiglWrapperPath = resolve(
  __dirname,
  '../../../../../supabase/migrations/20260915102000_uba_redvault_round20_review_fixes.sql'
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

  it('guards the direct-split recorder with the same serialized check', () => {
    expect(existsSync(directSplitMigrationPath)).toBe(true);
    if (!existsSync(directSplitMigrationPath)) return;

    const migrationSql = normalizeSql(
      readFileSync(directSplitMigrationPath, 'utf8')
    );

    expect(migrationSql).toContain(
      'FROM public.orders AS o WHERE o.id = p_source_id FOR UPDATE'
    );
    expect(migrationSql).toContain(
      "v_shipping_status IN ('cancelled', 'canceled') OR v_payment_status = 'refunded'"
    );
    expect(migrationSql).toContain(
      "RAISE EXCEPTION 'settlement_order_cancelled'"
    );
  });

  it('covers both GIGL wrappers through delegation to the guarded primitives', () => {
    expect(existsSync(giglWrapperPath)).toBe(true);
    expect(existsSync(directSplitGiglWrapperPath)).toBe(true);
    if (!existsSync(giglWrapperPath) || !existsSync(directSplitGiglWrapperPath))
      return;

    const giglSql = normalizeSql(readFileSync(giglWrapperPath, 'utf8'));
    const directSplitGiglSql = normalizeSql(
      readFileSync(directSplitGiglWrapperPath, 'utf8')
    );

    expect(giglSql).toContain('RETURN public.record_merchant_settlement(');
    expect(directSplitGiglSql).toContain(
      'RETURN public.record_uba_redvault_direct_settlement('
    );
  });
});
