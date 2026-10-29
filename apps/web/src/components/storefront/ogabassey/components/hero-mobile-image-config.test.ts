import { describe, expect, it } from 'vitest';
import {
  capSrcSetWidthRungs,
  MOBILE_HERO_MAX_SRCSET_WIDTH,
  MOBILE_HERO_MIN_SRCSET_WIDTH,
} from './hero-mobile-image-config';

describe('hero-mobile-image-config', () => {
  it('caps responsive srcSet rungs to the mobile hero width bounds and 2-rung limit', () => {
    const srcSet = [256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840]
      .map((w) => `https://cdn.ogabassey.com/image/width=${w}/hero.avif ${w}w`)
      .join(', ');

    expect(
      capSrcSetWidthRungs(
        srcSet,
        MOBILE_HERO_MAX_SRCSET_WIDTH,
        MOBILE_HERO_MIN_SRCSET_WIDTH
      )
    ).toBe(
      'https://cdn.ogabassey.com/image/width=384/hero.avif 384w, https://cdn.ogabassey.com/image/width=750/hero.avif 750w'
    );
  });

  it('preserves undefined or non-width-descriptor srcSets and trims oversized URL pairs to the upper rung', () => {
    expect(capSrcSetWidthRungs(undefined, 750)).toBeUndefined();
    expect(
      capSrcSetWidthRungs('https://cdn.ogabassey.com/hero.avif', 750)
    ).toBe('https://cdn.ogabassey.com/hero.avif');

    const longPath = 'a'.repeat(200);
    const longSrcSet = `https://cdn.ogabassey.com/${longPath}?w=384 384w, https://cdn.ogabassey.com/${longPath}?w=750 750w`;
    expect(capSrcSetWidthRungs(longSrcSet, 750, 384)).toBe(
      `https://cdn.ogabassey.com/${longPath}?w=750 750w`
    );
  });

  it('sorts unsorted ladders and clamps over-cap-only ladders to maxWidth', () => {
    const unsorted =
      'https://cdn.ogabassey.com/image/width=750/hero.avif 750w, https://cdn.ogabassey.com/image/width=384/hero.avif 384w';
    expect(capSrcSetWidthRungs(unsorted, 750, 384)).toBe(
      'https://cdn.ogabassey.com/image/width=384/hero.avif 384w, https://cdn.ogabassey.com/image/width=750/hero.avif 750w'
    );

    const overCapOnly =
      'https://cdn.ogabassey.com/image/width=1080/hero.avif 1080w, https://cdn.ogabassey.com/image/width=1920/hero.avif 1920w';
    expect(capSrcSetWidthRungs(overCapOnly, 750, 384)).toBe(
      'https://cdn.ogabassey.com/image/width=750/hero.avif 750w'
    );
  });
});
