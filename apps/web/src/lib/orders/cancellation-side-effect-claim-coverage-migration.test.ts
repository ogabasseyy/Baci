import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const coverageRegression = readFileSync(
  resolve(
    process.cwd(),
    '../../supabase/migrations/tests/cancellation_side_effect_claim_coverage.sql'
  ),
  'utf8'
);

describe('Cancellation side-effect claim coverage migration', () => {
  it('ships a claim-before-execute coverage regression', () => {
    expect(coverageRegression).toContain(
      'claim_order_cancellation_side_effect('
    );
    expect(coverageRegression).toContain('partial cover must stay claimed');
    expect(coverageRegression).toContain('split cover must auto-complete');
    expect(coverageRegression).toContain('currency mismatch must stay claimed');
    expect(coverageRegression).toContain(
      'legacy sole-payment cover must auto-complete'
    );
    expect(coverageRegression).toContain(
      'unverified full cover must stay claimed'
    );
    expect(coverageRegression).toContain('ROLLBACK;');
  });
});
