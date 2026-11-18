import { withSpread } from './quiz-with-spread';

describe('withSpread', () => {
  it('returns the base value when the random source is centred', () => {
    expect(withSpread(10_000, () => 0.5)).toBe(10_000);
  });

  it('spans plus/minus 20% across the random range', () => {
    expect(withSpread(10_000, () => 0)).toBe(8_000);
    expect(withSpread(10_000, () => 1)).toBe(12_000);
  });

  it('stays within bounds for many Math.random draws', () => {
    for (let i = 0; i < 200; i += 1) {
      const value = withSpread(10_000);
      expect(value).toBeGreaterThanOrEqual(8_000);
      expect(value).toBeLessThanOrEqual(12_000);
    }
  });
});
