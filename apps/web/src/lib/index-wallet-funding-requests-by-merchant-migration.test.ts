import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903220100_index_wallet_funding_requests_by_merchant.sql'
  ),
  'utf8'
);

describe('wallet funding requests merchant index migration', () => {
  it('adds a full merchant_id index for funding-request lookups', () => {
    expect(sql).toContain('merchant_wallet_funding_requests_merchant_id_idx');
    expect(sql).toContain(
      'ON public.merchant_wallet_funding_account_requests (merchant_id)'
    );
  });
});
