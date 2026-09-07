import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260903121000_permit_wallet_quote_invalidation.sql`,
  'utf8'
);

describe('wallet quote invalidation funding-source permit', () => {
  it('allows selected_quote_id to be cleared without an attested replacement', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION private.enforce_gigl_wallet_funding_source()'
    );
    expect(sql).toContain('IF NEW.selected_quote_id IS NULL THEN');
    expect(sql).toContain('RETURN NEW;');
    expect(sql).not.toContain(
      'IF NEW.selected_quote_id IS NULL\n     OR NOT EXISTS'
    );
    expect(sql).toContain(
      "RAISE EXCEPTION 'merchant_wallet_funding_requires_attested_quote'"
    );
  });
});
