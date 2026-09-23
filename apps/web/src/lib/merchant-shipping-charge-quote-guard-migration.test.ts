import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260901202000_block_active_shipping_charge_quote_replacement.sql'
  ),
  'utf8'
);

describe('active shipping charge quote replacement migration', () => {
  it('installs a private security-definer trigger with exact active statuses', () => {
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path = ''");
    expect(sql).toContain(
      "c.status IN ('reserved', 'provider_submitting', 'needs_reconciliation')"
    );
    expect(sql).toContain(
      'BEFORE UPDATE OF selected_quote_id ON public.orders'
    );
    expect(sql).toContain(
      'EXECUTE FUNCTION private.block_active_shipping_charge_quote_replacement()'
    );
    expect(sql).not.toMatch(/GRANT\s+/i);
  });
  it('allows same-quote updates and raises only on replacement with an active hold', () => {
    expect(sql).toContain(
      'NEW.selected_quote_id IS NOT DISTINCT FROM OLD.selected_quote_id'
    );
    expect(sql).toContain('active_shipping_charge_quote_replacement_blocked');
    expect(sql).toContain("USING ERRCODE = 'P0001'");
  });
});
