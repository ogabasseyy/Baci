import { describe, expect, it } from 'vitest';
import { isSantaGrantedPriceWithinCeiling } from './santa-granted-price';

describe('isSantaGrantedPriceWithinCeiling', () => {
  it('accepts a grant inside the ceiling', () => {
    expect(isSantaGrantedPriceWithinCeiling(100_000, 99_000, 2)).toBe(true);
  });

  it('accepts a grant at the exact ceiling boundary', () => {
    expect(isSantaGrantedPriceWithinCeiling(100_000, 98_000, 2)).toBe(true);
  });

  it('rejects a grant above the ceiling', () => {
    expect(isSantaGrantedPriceWithinCeiling(100_000, 97_999, 2)).toBe(false);
  });

  it('rejects every discount when the ceiling is zero', () => {
    expect(isSantaGrantedPriceWithinCeiling(100_000, 99_999, 0)).toBe(false);
  });

  it('fails closed on invalid inputs', () => {
    expect(isSantaGrantedPriceWithinCeiling(0, 0, 2)).toBe(false);
    expect(isSantaGrantedPriceWithinCeiling(100_000, -1, 2)).toBe(false);
    expect(isSantaGrantedPriceWithinCeiling(100_000, 99_000, Number.NaN)).toBe(
      false
    );
  });
});
