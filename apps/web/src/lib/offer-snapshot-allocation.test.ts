import { describe, expect, it } from 'vitest';
import { parseOfferSnapshotAllocation } from './offer-snapshot-allocation';

describe('parseOfferSnapshotAllocation', () => {
  it('distinguishes missing and unlimited snapshots from valid allocations', () => {
    expect(parseOfferSnapshotAllocation(undefined)).toBeUndefined();
    expect(parseOfferSnapshotAllocation(null)).toBeNull();
    expect(parseOfferSnapshotAllocation('12')).toBe(12);
    expect(parseOfferSnapshotAllocation(0)).toBe(0);
  });
  it('fails closed for malformed, negative and unsafe allocations', () => {
    for (const value of [
      '1.5',
      '-1',
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      {},
    ]) {
      expect(parseOfferSnapshotAllocation(value)).toBe(0);
    }
  });
});
