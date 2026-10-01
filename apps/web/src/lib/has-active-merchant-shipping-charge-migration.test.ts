import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260904152000_has_active_merchant_shipping_charge.sql`,
  'utf8'
);

describe('has_active_merchant_shipping_charge migration', () => {
  it('authorizes owners and orders fulfill/edit staff like wallet reserve RPCs', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.has_active_merchant_shipping_charge'
    );
    expect(sql).toContain('merchant.user_id = (SELECT auth.uid())');
    expect(sql).toContain("'orders', 'fulfill'");
    expect(sql).toContain("'orders', 'edit'");
    expect(sql).toContain("'reserved', 'provider_submitting'");
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.has_active_merchant_shipping_charge(uuid, uuid)'
    );
  });
});
