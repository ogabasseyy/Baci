import { describe, expect, it } from 'vitest';
import { isVariantOnlyComparisonSegment } from './is-variant-only-comparison-segment';

describe('isVariantOnlyComparisonSegment', () => {
  it('accepts shorthand capacity segments', () => {
    const result = isVariantOnlyComparisonSegment(['256', 'gb', 'comparison']);

    expect(result).toBe(true);
  });

  it('rejects a different product segment that also contains capacity', () => {
    const result = isVariantOnlyComparisonSegment([
      'samsung',
      'galaxy',
      's25',
      '256gb',
    ]);

    expect(result).toBe(false);
  });

  it('accepts product-tier shorthand segments', () => {
    const result = isVariantOnlyComparisonSegment(['pro', 'comparison']);

    expect(result).toBe(true);
  });

  it('accepts single-letter Xbox Series shorthand segments', () => {
    expect(isVariantOnlyComparisonSegment(['s', 'comparison'])).toBe(true);
    expect(isVariantOnlyComparisonSegment(['x', 'comparison'])).toBe(true);
  });

  it('accepts a color-only compare continuation', () => {
    const result = isVariantOnlyComparisonSegment(['blue', 'comparison']);

    expect(result).toBe(true);
  });

  it('accepts a refresh-rate-only compare continuation', () => {
    const result = isVariantOnlyComparisonSegment(['240hz', 'comparison']);

    expect(result).toBe(true);
  });

  it('accepts a region-only compare continuation', () => {
    const result = isVariantOnlyComparisonSegment(['uk', 'comparison']);

    expect(result).toBe(true);
  });

  it('accepts numeric laptop processor tiers in shorthand comparisons', () => {
    expect(isVariantOnlyComparisonSegment(['12500h', 'comparison'])).toBe(true);
  });
});
