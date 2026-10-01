import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260825160000_bind_social_ads_spend_replacement_account.sql'
  ),
  'utf8'
);

describe('account-bound social spend replacement migration', () => {
  it('binds empty and populated replacements to the selected account', () => {
    expect(migration).toContain('p_provider_customer_id pg_catalog.text');
    expect(migration).toContain(
      "RAISE EXCEPTION 'ads account changed during spend replacement'"
    );
    expect(migration).toContain(
      'provider_customer_id = pg_catalog.btrim(p_provider_customer_id)'
    );
  });

  it('accepts bounded timezone identifiers containing digits', () => {
    expect(migration).toContain("p_account_timezone !~ '^[A-Za-z0-9_+/-]+$'");
  });
});
