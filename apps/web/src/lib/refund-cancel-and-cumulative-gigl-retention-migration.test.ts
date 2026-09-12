import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903215300_refund_cancel_and_cumulative_gigl_retention.sql'
  ),
  'utf8'
);

describe('refund cancel and cumulative gigl retention migration', () => {
  it('refunds reserved charges on cancel and undoes guessed legacy stamps', () => {
    expect(sql).toContain("charge.status = 'reserved'");
    expect(sql).toContain('ORDER_CANCELLED_BEFORE_SUBMISSION');
    expect(sql).toContain("charge.status IN ('provider_submitting')");
    expect(sql).toContain(
      "sq.pricing_version IS DISTINCT FROM 'gigl_platform_margin_v1'"
    );
    expect(sql).toContain('v_already_retained');
    expect(sql).toContain('retained_shipping_amount');
  });
});
