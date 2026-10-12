import { describe, expect, it } from 'vitest';
import { isPiggyvestInterestRequestPath } from './interest-request-path';

describe('isPiggyvestInterestRequestPath', () => {
  it('requires independently validated wallet identifiers', () => {
    expect(
      isPiggyvestInterestRequestPath(
        '/api/v1/wallet/interests/accrued/wallet',
        () => false
      )
    ).toBe(false);
  });
  it('accepts a valid leap-day date range', () => {
    expect(
      isPiggyvestInterestRequestPath(
        '/api/v1/wallet/interests/accrued/wallet?start_date=2024-02-29&end_date=2024-03-01',
        () => true
      )
    ).toBe(true);
  });
  it('rejects extra path segments', () => {
    expect(
      isPiggyvestInterestRequestPath(
        '/api/v1/wallet/interests/accrued/wallet/other',
        () => true
      )
    ).toBe(false);
  });
});
