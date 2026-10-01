import { describe, expect, it } from 'vitest';
import { isReady } from './plan-readiness';

describe('isReady', () => {
  it('reads ready when spendable covers the price', () => {
    // Arrange & Act & Assert
    expect(isReady(10_000_000, 10_000_000)).toBe(true);
    expect(isReady(9_999_999, 10_000_000)).toBe(false);
  });

  it('never reads ready on a zero price', () => {
    // Arrange & Act & Assert: a zero price would mark an unfunded plan
    // ready, so it throws instead.
    expect(() => isReady(10_000_000, 0)).toThrow(RangeError);
  });
});
