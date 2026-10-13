import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260903124000_use_immutable_checkout_shipping_retention.sql`,
  'utf8'
);

describe('immutable checkout shipping retention', () => {
  it('freezes customer-checkout economics on later quote selection changes', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION private.stamp_gigl_order_economics()'
    );
    expect(sql).toContain("OLD.shipping_funding_source = 'customer_checkout'");
    expect(sql).toContain(
      'NEW.shipping_platform_retained_amount := OLD.shipping_platform_retained_amount;'
    );
    expect(
      sql.indexOf("OLD.shipping_funding_source = 'customer_checkout'")
    ).toBeLessThan(sql.indexOf('IF NEW.selected_quote_id IS NULL THEN'));
  });

  it('settles from the order snapshot instead of the live quote price', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.record_merchant_settlement_gigl_v1('
    );
    expect(sql).toContain('THEN o.shipping_platform_retained_amount');
    expect(sql).not.toContain('THEN sq.price');
    expect(sql).not.toContain('LEFT JOIN public.shipping_quotes');
  });
});
