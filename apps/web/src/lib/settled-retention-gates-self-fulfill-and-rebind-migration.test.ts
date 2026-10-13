import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260904153000_settled_retention_gates_self_fulfill_and_rebind.sql'
  ),
  'utf8'
);

describe('settled retention gates self-fulfill and rebind migration', () => {
  it('forbids checkout→wallet rebind only when shipping retention has settled', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION private.order_settled_gigl_retained_amount('
    );
    expect(sql).toContain("AND settlement.status IS DISTINCT FROM 'cancelled'");
    expect(sql).toContain(
      'AND private.order_settled_gigl_retained_amount(p_order_id, p_merchant_id) > 0'
    );
    expect(sql).toContain('customer_checkout_wallet_rebind_forbidden');
    expect(sql).not.toMatch(
      /shipping_funding_source = 'customer_checkout'\s*\n\s*AND COALESCE\(v_order\.shipping_platform_retained_amount, 0\) > 0/
    );
  });

  it('bugfix: rejects self-fulfillment after settled retention instead of clearing the snapshot only', () => {
    expect(sql).toContain('settled_checkout_retention_blocks_self_fulfillment');
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.self_fulfill_order_with_wallet_release('
    );
    const selfFulfill = sql.slice(
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION public.self_fulfill_order_with_wallet_release('
      )
    );
    expect(selfFulfill).toContain(
      'private.order_settled_gigl_retained_amount(\n       p_order_id, v_order.merchant_id\n     ) > 0'
    );
  });

  it('preserves checkout economics from settled retention, not snapshot alone', () => {
    const stamp = sql.slice(
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION private.stamp_gigl_order_economics()'
      )
    );
    expect(stamp).toContain('v_settled_retained > 0');
    expect(stamp).toContain(
      "NEW.shipping_funding_source := 'customer_checkout'"
    );
  });
});
