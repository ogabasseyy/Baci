import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../../../../supabase/migrations/20261016010000_serialize_vtu_refund_retry.sql'
);
const regressionPath = resolve(
  __dirname,
  '../../../../supabase/migrations/tests/vtu_refund_retry_serialization.sql'
);

describe('VTU refund/retry serialization migration', () => {
  it('guards both refund RPCs on the caller-observed status', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('p_expected_status text DEFAULT NULL::text');
    expect(sql).toContain('VTU transaction status changed under refund');
    expect(sql).toContain('VTU transaction status changed under reversal');
    expect(sql).toContain('FOR UPDATE');
  });

  it('claims failed retries atomically against the ledger', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION public.claim_failed_vtu_retry'
    );
    expect(sql).toContain("'status_moved'");
    expect(sql).toContain("'already_refunded'");
    expect(sql).toContain("'vtu_wallet_reversal'");
    expect(sql).toContain('vtu_transaction_refund');
    expect(sql).toContain('idx_customer_wallet_transactions_vtu_refund_source');
  });

  it('ships a live serialization regression', () => {
    const sql = readFileSync(regressionPath, 'utf8');

    expect(sql).toContain('REFUND-RETRY-REGRESSION');
    expect(sql).toContain('clean failed claim refused');
    expect(sql).toContain('moved-status refund did not raise 42501');
    expect(sql).toContain('NULL-expected refund did not succeed');
    expect(sql).toContain('moved-status reversal did not raise 42501');
    expect(sql).toContain('ROLLBACK;');
  });
});
