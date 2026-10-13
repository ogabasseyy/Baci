import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260904082200_reject_unsafe_customer_checkout_rebind.sql'
  ),
  'utf8'
);

describe('reject unsafe customer checkout rebind migration', () => {
  it('refuses admin wallet rebinding that would preserve checkout retention', () => {
    expect(sql).toContain('bind_admin_gigl_quote');
    expect(sql).toContain('customer_checkout_wallet_rebind_forbidden');
    expect(sql).toContain(
      "v_order.shipping_funding_source = 'customer_checkout'"
    );
    expect(sql).toContain('shipping_platform_retained_amount');
  });

  it('raises when stamp economics sees a checkout-to-wallet conversion', () => {
    expect(sql).toContain('stamp_gigl_order_economics');
    expect(sql).toContain("NEW.shipping_funding_source = 'merchant_wallet'");
  });
});
