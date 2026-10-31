import { describe, expect, it } from 'vitest';
import { selectHeroAvifQualityForByteCap } from './select-hero-avif-quality-for-byte-cap';

describe('selectHeroAvifQualityForByteCap', () => {
  it('returns null when no candidates are provided', () => {
    expect(selectHeroAvifQualityForByteCap([])).toBeNull();
  });

  it('returns the highest quality step that stays within the byte cap', () => {
    expect(
      selectHeroAvifQualityForByteCap([
        { quality: 70, bytes: 21_500 },
        { quality: 60, bytes: 17_800 },
        { quality: 50, bytes: 13_400 },
      ])
    ).toEqual({ quality: 60, bytes: 17_800 });

    expect(
      selectHeroAvifQualityForByteCap([
        { quality: 70, bytes: 14_200 },
        { quality: 60, bytes: 11_000 },
        { quality: 50, bytes: 9_100 },
      ])
    ).toEqual({ quality: 70, bytes: 14_200 });
  });

  it('falls back to the lowest quality rung when all candidates exceed the cap', () => {
    expect(
      selectHeroAvifQualityForByteCap([
        { quality: 70, bytes: 26_000 },
        { quality: 60, bytes: 22_000 },
        { quality: 50, bytes: 20_500 },
      ])
    ).toEqual({ quality: 50, bytes: 20_500 });
  });
});
