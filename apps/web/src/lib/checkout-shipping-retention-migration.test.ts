import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260903123000_preserve_checkout_shipping_retention.sql`,
  'utf8'
);

describe('checkout shipping retention snapshot', () => {
  it('keeps the previously stamped customer-checkout economics when the quote is cleared', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION private.stamp_gigl_order_economics()'
    );
    expect(sql).toContain("OLD.shipping_funding_source = 'customer_checkout'");
    expect(sql).toContain(
      'NEW.shipping_platform_retained_amount := OLD.shipping_platform_retained_amount;'
    );
  });

  it('falls back to the stamped retained amount when the live quote is gone', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.record_merchant_settlement_gigl_v1('
    );
    expect(sql).toContain('THEN o.shipping_platform_retained_amount');
    expect(sql).toContain('THEN sq.price');
    expect(sql.indexOf('THEN sq.price')).toBeLessThan(
      sql.indexOf('THEN o.shipping_platform_retained_amount')
    );
  });
});
