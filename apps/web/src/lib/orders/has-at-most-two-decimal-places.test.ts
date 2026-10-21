import { describe, expect, it } from 'vitest';
import { hasAtMostTwoDecimalPlaces } from './has-at-most-two-decimal-places';

describe('hasAtMostTwoDecimalPlaces', () => {
  it('accepts whole and two-decimal amounts', () => {
    expect(hasAtMostTwoDecimalPlaces(100)).toBe(true);
    expect(hasAtMostTwoDecimalPlaces(27574.83)).toBe(true);
    expect(hasAtMostTwoDecimalPlaces(0.5)).toBe(true);
  });
  it('rejects three-decimal amounts', () => {
    expect(hasAtMostTwoDecimalPlaces(10.125)).toBe(false);
    expect(hasAtMostTwoDecimalPlaces(0.001)).toBe(false);
  });
  it('expands exponent forms to their true places', () => {
    // 1e21 is a whole-naira magnitude: valid despite the exponent.
    expect(hasAtMostTwoDecimalPlaces(1e21)).toBe(true);
    // 1.5e-3 is 0.0015: four true places, invalid.
    expect(hasAtMostTwoDecimalPlaces(1.5e-3)).toBe(false);
  });
  it('rejects non-finite values', () => {
    expect(hasAtMostTwoDecimalPlaces(Number.NaN)).toBe(false);
    expect(hasAtMostTwoDecimalPlaces(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
