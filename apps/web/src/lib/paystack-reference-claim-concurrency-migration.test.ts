import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const concurrencyRegression = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/tests/paystack_reference_claim_concurrency.sql'
  ),
  'utf8'
);
const concurrencyRunner = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/tests/run-paystack-reference-claim-concurrency-test.sh'
  ),
  'utf8'
);

describe('Paystack reference-claim concurrency migration', () => {
  it('ships a two-session reference-claim concurrency regression', () => {
    expect(concurrencyRegression).toContain('dblink_send_query');
    expect(concurrencyRegression).toContain(
      "dblink_exec('paystack_manual_claim', 'BEGIN')"
    );
    expect(concurrencyRegression).toContain(
      "dblink_exec('paystack_gateway_claim', 'BEGIN')"
    );
    expect(concurrencyRegression).toContain(
      'reconcile_paystack_unmatched_partial_payment('
    );
    expect(concurrencyRegression).toContain(
      'public.create_payment_transaction('
    );
    expect(concurrencyRegression).toContain(
      'expected one Paystack claim success and one expected conflict'
    );
    expect(concurrencyRegression).toContain(
      "'paystack_reference_already_recorded'"
    );
    expect(concurrencyRegression).toContain("'reference_in_use'");
    expect(concurrencyRegression).toContain(
      "PERFORM * FROM dblink_get_result('paystack_manual_claim')"
    );
    expect(concurrencyRegression).toContain(
      "PERFORM * FROM dblink_get_result('paystack_gateway_claim')"
    );
    expect(concurrencyRunner).toContain(
      'paystack_reference_claim_concurrency.sql'
    );
    expect(concurrencyRunner).toContain('docker run');
  });
});
