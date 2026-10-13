import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260805151500_fail_closed_merchant_payout_requests.sql'
  ),
  'utf8'
);

describe('merchant payout requests fail-closed migration contract', () => {
  it('denies direct merchant INSERT by removing both the policy and privileges', () => {
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Merchants can create their own payout requests"'
    );
    expect(migration).toContain('REVOKE ALL ON TABLE public.payout_requests');
    expect(migration).toContain('FROM PUBLIC, anon, authenticated;');
    expect(migration).not.toMatch(
      /CREATE POLICY[\s\S]*public\.payout_requests[\s\S]*FOR INSERT/
    );
    expect(migration).not.toContain(
      'GRANT INSERT ON TABLE public.payout_requests TO authenticated'
    );
  });

  it('preserves only merchant-scoped history reads for authenticated users', () => {
    expect(migration).toContain('FOR SELECT');
    expect(migration).toContain('TO authenticated');
    expect(migration).toContain('merchant.user_id = (SELECT auth.uid())');
    expect(migration).toContain(
      'GRANT SELECT ON TABLE public.payout_requests TO authenticated;'
    );
  });

  it('preserves the trusted worker boundary without creating a payout path', () => {
    expect(migration).toContain(
      'GRANT ALL ON TABLE public.payout_requests TO service_role;'
    );
    expect(migration).not.toContain('CREATE FUNCTION');
    expect(migration).not.toContain('INSERT INTO');
  });

  it('allows only merchant-scoped wallet reads and payout-settings updates', () => {
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Merchants can update their wallet settings"'
    );
    expect(migration).toContain('ON public.merchant_wallets');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain('WITH CHECK');
    expect(migration).toContain('REVOKE ALL ON TABLE public.merchant_wallets');
    expect(migration).toContain(
      'GRANT SELECT ON TABLE public.merchant_wallets TO authenticated;'
    );
    expect(migration).toContain(
      'GRANT UPDATE (auto_payout_enabled, auto_payout_day, min_payout_amount)'
    );
    expect(migration).toContain(
      'ON TABLE public.merchant_wallets TO authenticated;'
    );
    expect(migration).toContain(
      'AND min_payout_amount BETWEEN 1000 AND 10000000'
    );
  });

  it('does not grant authenticated callers direct wallet balance updates', () => {
    const authenticatedWalletGrants = migration.match(
      /GRANT\s+(?:SELECT|UPDATE\s+\([^)]*\))\s+ON TABLE public\.merchant_wallets TO authenticated;/g
    );

    expect(authenticatedWalletGrants).toEqual([
      'GRANT SELECT ON TABLE public.merchant_wallets TO authenticated;',
      'GRANT UPDATE (auto_payout_enabled, auto_payout_day, min_payout_amount)\n  ON TABLE public.merchant_wallets TO authenticated;',
    ]);
  });

  it('keeps trusted settlement workers on the service-role boundary', () => {
    expect(migration).toContain(
      'GRANT ALL ON TABLE public.merchant_wallets TO service_role;'
    );
  });
});
