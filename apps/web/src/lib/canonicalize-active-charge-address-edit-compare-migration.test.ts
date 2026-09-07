import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260906120200_canonicalize_active_charge_address_edit_compare.sql'
  ),
  'utf8'
);

describe('canonicalize active charge address edit compare', () => {
  it('bugfix: trigger and wrapper use the same canonical address representation', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION private.block_active_shipping_charge_address_edit('
    );
    expect(sql).toContain('v_new_address IS NOT DISTINCT FROM v_old_address');
    expect(sql).toContain('Canonical no-op: keep the stored address bytes');
    expect(sql).toContain(
      "jsonb_set(\n          p_payload,\n          '{shipping_address}',"
    );
    expect(sql).toContain("COALESCE(v_order.shipping_address, '{}'::jsonb)");
  });
});
