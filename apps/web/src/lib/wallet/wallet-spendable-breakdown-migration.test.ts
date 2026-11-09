import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(
    process.cwd(),
    '../../supabase/migrations/20261109130000_wallet_spendable_breakdown.sql'
  ),
  'utf8'
);

describe('get_merchant_wallet_spendable_breakdown migration', () => {
  it('uses the same spendable rule as reserve_merchant_shipping_charge', () => {
    expect(sql).toContain('private.merchant_wallet_direct_settled_exposure');
    expect(sql).toMatch(/GREATEST\(/);
  });
  it('is SECURITY DEFINER, read-only, merchant-scoped by analytics.view', () => {
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/STABLE/);
    expect(sql).toContain("'analytics', 'view'");
    expect(sql).not.toMatch(
      /\b(UPDATE|INSERT|DELETE)\b\s+(public\.)?merchant/i
    );
  });
  it('revokes from PUBLIC, anon and authenticated before granting', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_merchant_wallet_spendable_breakdown\(uuid\)\s+FROM PUBLIC, anon, authenticated/
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_merchant_wallet_spendable_breakdown\(uuid\)\s+TO authenticated/
    );
  });
});
