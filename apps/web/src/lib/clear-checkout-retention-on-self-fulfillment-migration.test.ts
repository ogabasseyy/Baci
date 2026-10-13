import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260904123100_clear_checkout_retention_on_self_fulfillment.sql'
  ),
  'utf8'
);

describe('clear checkout retention on self-fulfillment migration', () => {
  it('clears GIGL checkout economics when converting to self-fulfillment', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION private.stamp_gigl_order_economics()'
    );
    expect(sql).toContain("NEW.fulfillment_type = 'self'");
    expect(sql).toContain(
      "COALESCE(OLD.fulfillment_type, '') IS DISTINCT FROM 'self'"
    );
    expect(sql).toContain('NEW.selected_quote_id IS NULL');
    expect(sql).toContain("NEW.shipping_status IN ('shipped', 'delivered')");
    expect(sql).toContain('NEW.shipping_platform_retained_amount := 0');
    expect(sql).toContain('NEW.shipping_funding_source := NULL');
  });

  it('keeps checkout-to-wallet rebind rejection ahead of self-fulfill clearing', () => {
    const rebindIndex = sql.indexOf(
      'customer_checkout_wallet_rebind_forbidden'
    );
    const selfFulfillIndex = sql.indexOf("NEW.fulfillment_type = 'self'");
    expect(rebindIndex).toBeGreaterThan(-1);
    expect(selfFulfillIndex).toBeGreaterThan(rebindIndex);
  });
});
