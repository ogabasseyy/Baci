import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  `${process.cwd()}/../../supabase/migrations/20260903127000_reject_merchant_wallet_funding_alias_conflict.sql`,
  'utf8'
);

describe('merchant wallet alias-conflict rejection', () => {
  it('fails the pending request and files an idempotent operator review', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.reject_merchant_wallet_funding_alias_conflict('
    );
    expect(sql).toContain("SET status = 'failed'");
    expect(sql).toContain("'wallet_dva_order_alias_conflict'");
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.reject_merchant_wallet_funding_alias_conflict'
    );
    expect(sql).toContain('TO service_role');
  });
});
