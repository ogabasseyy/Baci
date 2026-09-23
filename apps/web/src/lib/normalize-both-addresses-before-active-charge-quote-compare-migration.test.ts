import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260906120100_normalize_both_addresses_before_active_charge_quote_compare.sql'
  ),
  'utf8'
);

describe('normalize both addresses before active charge quote compare', () => {
  it('normalizes existing and reconstructed addresses before IS DISTINCT FROM', () => {
    expect(sql).toContain(
      'Normalize both existing and reconstructed shipping addresses'
    );
    expect(sql).toContain(
      "NULLIF(\n            btrim(COALESCE(v_order.shipping_address, '{}'::jsonb) ->> 'city'),"
    );
    expect(sql).toContain('v_existing_shipping_address := jsonb_strip_nulls(');
    expect(sql).toContain('v_new_shipping_address := jsonb_strip_nulls(');
    expect(sql).toContain(
      'IF v_new_shipping_address IS DISTINCT FROM v_existing_shipping_address THEN'
    );
  });
});
