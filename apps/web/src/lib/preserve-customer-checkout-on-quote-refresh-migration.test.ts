import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  '../../supabase/migrations/20260904123300_preserve_customer_checkout_on_quote_refresh.sql'
);

describe('preserve customer checkout on quote refresh migration', () => {
  it('keeps customer_checkout funding when refreshing retained checkout quotes', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.persist_refreshed_order_shipping_quote\(/i
    );
    expect(sql).toContain(
      "v_order.shipping_funding_source = 'customer_checkout'"
    );
    expect(sql).toContain(
      'COALESCE(v_order.shipping_platform_retained_amount, 0) > 0'
    );
    expect(sql).toContain("WHEN v_preserve_checkout THEN 'customer_checkout'");
    expect(sql).toContain("ELSE 'merchant_wallet'");
    expect(sql).toContain(
      'WHEN v_preserve_checkout THEN v_order.shipping_platform_retained_amount'
    );
  });
});
