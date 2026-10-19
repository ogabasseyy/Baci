import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260904123200_align_zero_retention_checkout_rebind.sql'
  ),
  'utf8'
);

describe('align zero retention checkout rebind migration', () => {
  it('forbids checkout-to-wallet rebind only when retained amount is positive', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION private.stamp_gigl_order_economics()'
    );
    expect(sql).toContain(
      'COALESCE(OLD.shipping_platform_retained_amount, 0) > 0'
    );
    expect(sql).toContain("NEW.shipping_funding_source = 'merchant_wallet'");
    expect(sql).toContain('customer_checkout_wallet_rebind_forbidden');
    expect(sql).not.toMatch(
      /OLD\.shipping_platform_retained_amount IS NOT NULL\s*\n\s*AND NEW\.shipping_funding_source = 'merchant_wallet'/
    );
  });

  it('preserves checkout economics only for positive retention', () => {
    const preserveBlock = sql.slice(
      sql.indexOf("OLD.shipping_funding_source = 'customer_checkout'")
    );
    expect(preserveBlock).toContain(
      'COALESCE(OLD.shipping_platform_retained_amount, 0) > 0 THEN'
    );
    expect(preserveBlock).toContain(
      "NEW.shipping_funding_source := 'customer_checkout'"
    );
  });

  it('still clears checkout retention on trusted self-fulfillment', () => {
    expect(sql).toContain("NEW.fulfillment_type = 'self'");
    expect(sql).toContain('NEW.shipping_platform_retained_amount := 0');
    expect(sql).toContain('NEW.shipping_funding_source := NULL');
  });
});
