import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260906120300_reject_stale_order_inputs_before_admin_gigl_bind.sql'
  ),
  'utf8'
);

describe('reject stale order inputs before admin GIGL bind', () => {
  it('bugfix: compares current address and items before overwriting the order', () => {
    expect(sql).toContain('stale_order_quote_inputs');
    expect(sql).toContain('v_order.shipping_address');
    expect(sql).toContain("v_attestation.quote_request -> 'items'");
    expect(sql.indexOf('stale_order_quote_inputs')).toBeLessThan(
      sql.indexOf('UPDATE public.orders')
    );
  });
});
