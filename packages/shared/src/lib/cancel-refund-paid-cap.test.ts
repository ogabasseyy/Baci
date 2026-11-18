import { describe, expect, it } from 'vitest';
import { exceedsRecordedPaid } from './cancel-refund-paid-cap';

const check = (
  amountPaid: number | null,
  outstandingMinor: number,
  derivedPaidMinor = 0
) => exceedsRecordedPaid({ amountPaid, derivedPaidMinor, outstandingMinor });

describe('exceedsRecordedPaid', () => {
  it('is resolved when outstanding captures fit the recorded amount', () => {
    expect(check(100, 10000)).toBe(false);
    expect(check(100, 5000)).toBe(false);
  });

  it('is unresolved when outstanding captures exceed the recorded amount', () => {
    expect(check(100, 20000)).toBe(true);
  });

  it('is unresolved when the recorded amount is missing or not a number', () => {
    expect(check(null, 10000)).toBe(true);
    expect(check(Number.NaN, 10000)).toBe(true);
    expect(check(Number.POSITIVE_INFINITY, 10000)).toBe(true);
  });

  it('rounds the recorded amount to minor units at the boundary', () => {
    // 0.1 + 0.2 floats to 0.30000000000000004: still exactly 30 minor units.
    expect(check(0.1 + 0.2, 30)).toBe(false);
    expect(check(0.1 + 0.2, 31)).toBe(true);
    expect(check(19.99, 1999)).toBe(false);
    expect(check(19.99, 2000)).toBe(true);
  });

  it('derives a never-stamped zero total from the funded legs', () => {
    expect(check(0, 10000, 10000)).toBe(false);
    expect(check(0, 20000, 10000)).toBe(true);
    expect(check(0, 100, 0)).toBe(true);
  });
});
