import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260905113200_block_active_charge_quote_input_admin_edits.sql'
  ),
  'utf8'
);

describe('block active charge quote input admin edits migration', () => {
  it('rejects transactional edits while a wallet charge is active', () => {
    expect(sql).toContain(
      "RAISE EXCEPTION 'active_shipping_charge_quote_input_edit_blocked'"
    );
    const raiseAt = sql.indexOf(
      "RAISE EXCEPTION 'active_shipping_charge_quote_input_edit_blocked'"
    );
    const v1Call = sql.indexOf(
      'update_admin_order_with_transaction_discount_metadata_v1'
    );
    expect(raiseAt).toBeGreaterThan(-1);
    expect(v1Call).toBeGreaterThan(raiseAt);
  });
});
