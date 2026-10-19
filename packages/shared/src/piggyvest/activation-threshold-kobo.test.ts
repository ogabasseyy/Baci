import { describe, expect, it } from 'vitest';
import { activationThresholdKobo } from './activation-threshold-kobo';

describe('activationThresholdKobo', () => {
  it('returns 5% of the quoted price', () => {
    // Arrange & Act & Assert
    expect(activationThresholdKobo(10_000_000)).toBe(500_000);
  });

  it('rounds fractional kobo up', () => {
    // Arrange & Act & Assert: 5% of 101 is 5.05, so the threshold is 6.
    expect(activationThresholdKobo(101)).toBe(6);
  });

  it('rejects zero and negative prices', () => {
    // Arrange & Act & Assert: a zero price would zero the threshold so an
    // unfunded plan reads activated.
    expect(() => activationThresholdKobo(0)).toThrow(RangeError);
    expect(() => activationThresholdKobo(-100)).toThrow(RangeError);
  });
});
