import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260905114000_compare_quote_inputs_before_active_charge_admin_edit_block.sql'
  ),
  'utf8'
);

describe('compare quote inputs before active charge admin edit block', () => {
  it('rejects only when shipping_address, items, or shipping_fee would change', () => {
    expect(sql).toContain('v_quote_inputs_would_change');
    expect(sql).toContain("p_payload -> 'shipping_fee'");
    expect(sql).toContain("p_payload -> 'shipping_address'");
    expect(sql).toContain('FROM public.order_items AS oi');
    expect(sql).toContain(
      "RAISE EXCEPTION 'active_shipping_charge_quote_input_edit_blocked'"
    );

    const raiseAt = sql.indexOf(
      "RAISE EXCEPTION 'active_shipping_charge_quote_input_edit_blocked'"
    );
    const compareGuard = sql.indexOf('IF v_quote_inputs_would_change THEN');
    const v1Call = sql.indexOf(
      'update_admin_order_with_transaction_discount_metadata_v1'
    );
    expect(compareGuard).toBeGreaterThan(-1);
    expect(raiseAt).toBeGreaterThan(compareGuard);
    expect(v1Call).toBeGreaterThan(raiseAt);
  });
});
