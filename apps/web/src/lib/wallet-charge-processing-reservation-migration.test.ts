import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260903125000_require_processing_wallet_charge_reservation.sql`,
  'utf8'
);

describe('wallet charge reservation processing guard', () => {
  it('requires a processing, non-cancelled order before debiting the wallet', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.reserve_merchant_shipping_charge('
    );
    expect(sql).toContain(
      "OR lower(COALESCE(v_order.shipping_status, '')) IS DISTINCT FROM 'processing'"
    );
    expect(sql).toContain('OR v_order.cancelled_at IS NOT NULL THEN');
  });
});
