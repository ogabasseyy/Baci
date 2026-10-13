import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903215400_partial_invoice_gigl_shipping_retention.sql'
  ),
  'utf8'
);

describe('partial invoice gigl shipping retention migration', () => {
  it('settles merchant-invoice partials through cumulative GIGL retention', () => {
    expect(sql).toContain('record_merchant_settlement_gigl_v1');
    expect(sql).toContain("'merchant_invoice_partial', true");
    expect(sql).not.toMatch(
      /PERFORM public\.record_merchant_settlement\(\s*p_merchant_id/
    );
  });
});
