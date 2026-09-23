import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/20260903213000_rotate_wallet_funding_recovery_hmac.sql'
  ),
  'utf8'
);

describe('rotate wallet funding recovery hmac migration', () => {
  it('replaces the repository-visible recovery seed and allows payment-replay reviews', () => {
    expect(sql).toContain("encode(extensions.gen_random_bytes(32), 'hex')");
    expect(sql).toContain(
      "secret = 'baci-merchant-wallet-funding-recovery-hmac-v1'"
    );
    expect(sql).toContain("'wallet_dva_order_payment_replay'");
    expect(sql).toContain('reconciliation_review_issue_type_check');
    expect(sql).not.toMatch(
      /INSERT INTO private\.merchant_wallet_funding_recovery_secrets[\s\S]*baci-merchant-wallet-funding-recovery-hmac-v1/
    );
  });
});
