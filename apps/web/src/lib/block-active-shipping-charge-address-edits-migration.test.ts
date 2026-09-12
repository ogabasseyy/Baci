import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260904180310_block_active_shipping_charge_address_edits.sql'
  ),
  'utf8'
);

describe('block active shipping charge address edits migration', () => {
  it('bugfix: rejects shipping_address updates while wallet charges are active', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION private.block_active_shipping_charge_address_edit('
    );
    expect(sql).toContain('BEFORE UPDATE OF shipping_address ON public.orders');
    expect(sql).toContain("'reserved'");
    expect(sql).toContain("'provider_submitting'");
    expect(sql).toContain("'needs_reconciliation'");
    expect(sql).toContain('active_shipping_charge_address_edit_blocked');
  });
});
