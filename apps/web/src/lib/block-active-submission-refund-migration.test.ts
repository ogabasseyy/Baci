import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903220600_block_active_submission_refund_and_token_refresh.sql'
  ),
  'utf8'
);

describe('block active submission refund migration', () => {
  it('keeps non-stale provider_submitting tokens immutable in reserve', () => {
    const reserveStart = sql.indexOf(
      'CREATE OR REPLACE FUNCTION public.reserve_merchant_shipping_charge'
    );
    const refundStart = sql.indexOf(
      'CREATE OR REPLACE FUNCTION public.refund_merchant_shipping_charge'
    );
    const reserveSql = sql.slice(reserveStart, refundStart);
    expect(reserveSql).toContain("v_existing.status = 'provider_submitting'");
    expect(reserveSql).not.toMatch(
      /ELSIF v_existing\.status = 'provider_submitting' THEN[\s\S]*attempt_token_digest/
    );
  });

  it('refuses authenticated refunds while provider submission is still active', () => {
    const refundSql = sql.slice(
      sql.indexOf(
        'CREATE OR REPLACE FUNCTION public.refund_merchant_shipping_charge'
      )
    );
    expect(refundSql).toContain("v_charge.status = 'provider_submitting'");
    expect(refundSql).toContain("interval '15 minutes'");
    expect(refundSql).toContain('RETURN v_charge.status;');
  });
});
