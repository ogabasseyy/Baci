import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260825150001_compare_and_set_ads_account_selection.sql'
  ),
  'utf8'
);

describe('ads account-selection credential compare-and-set migration', () => {
  it('guards Google and social account selection with the observed grant', () => {
    expect(migration).toContain('p_expected_access_token_ciphertext');
    expect(
      migration.match(/access_token_ciphertext IS NOT DISTINCT FROM/g)
    ).toHaveLength(2);
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.set_google_ads_customer'
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.set_merchant_ads_account'
    );
  });
});
