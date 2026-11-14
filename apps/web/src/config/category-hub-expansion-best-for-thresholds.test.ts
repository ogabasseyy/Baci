import { describe, expect, it } from 'vitest';
import { EXPANSION_BEST_FOR_THRESHOLDS } from './category-hub-expansion-best-for-thresholds';

describe('EXPANSION_BEST_FOR_THRESHOLDS', () => {
  it('defines valid positive thresholds for all 5 expansion categories', () => {
    const categories = [
      'gaming-laptops',
      'tablets',
      'audio',
      'smartwatches',
      'playstation-5',
    ] as const;

    for (const category of categories) {
      const thresholds = EXPANSION_BEST_FOR_THRESHOLDS[category];
      expect(thresholds).toBeDefined();

      for (const value of Object.values(thresholds)) {
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThan(0);
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('verifies audio and smartwatches midrange ceiling exceeds budget ceiling', () => {
    expect(
      EXPANSION_BEST_FOR_THRESHOLDS.audio.midrangeMaxPriceNgn
    ).toBeGreaterThan(EXPANSION_BEST_FOR_THRESHOLDS.audio.budgetMaxPriceNgn);
    expect(
      EXPANSION_BEST_FOR_THRESHOLDS.smartwatches.midrangeMaxPriceNgn
    ).toBeGreaterThan(
      EXPANSION_BEST_FOR_THRESHOLDS.smartwatches.budgetMaxPriceNgn
    );
  });
});
