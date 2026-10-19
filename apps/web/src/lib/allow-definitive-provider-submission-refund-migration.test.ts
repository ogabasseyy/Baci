import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260904082300_allow_definitive_provider_submission_refund.sql'
  ),
  'utf8'
);

describe('allow definitive provider submission refund migration', () => {
  it('only blocks recent provider_submitting refunds when a shipment is linked', () => {
    const refundSql = sql.slice(
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION public.refund_merchant_shipping_charge'
      )
    );
    expect(refundSql).toContain("v_charge.status = 'provider_submitting'");
    expect(refundSql).toContain("interval '15 minutes'");
    expect(refundSql).toContain('v_charge.shipment_id IS NOT NULL');
    expect(refundSql).toMatch(
      /provider_submitting[\s\S]*shipment_id IS NOT NULL[\s\S]*RETURN v_charge\.status/
    );
  });
});
