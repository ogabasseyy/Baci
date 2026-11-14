import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../../supabase/migrations/20261109130000_wallet_spendable_breakdown.sql'
  ),
  'utf8'
);

describe('get_merchant_wallet_spendable_breakdown migration', () => {
  it('keeps unreconciled exposure out of the settled-to-bank total', () => {
    expect(sql).toContain('pending_reconciliation_total');
    expect(sql).not.toMatch(/exposure\(wallet\.id\)\s*\+\s*COALESCE/);
  });
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
