import { describe, expect, it } from 'vitest';
import { computeHeroMobileHeadingMaxAreaPx2 } from './compute-hero-mobile-heading-max-area-px2';

describe('computeHeroMobileHeadingMaxAreaPx2', () => {
  it('computes the maximum 3-line h2 painted area for standard mobile viewports', () => {
    expect(computeHeroMobileHeadingMaxAreaPx2(360)).toBeCloseTo(9878.4, 2);
    expect(computeHeroMobileHeadingMaxAreaPx2(390)).toBeCloseTo(11012.4, 2);
    expect(computeHeroMobileHeadingMaxAreaPx2(412)).toBeCloseTo(11844, 2);
  });

  it('clamps non-positive viewport widths to zero area', () => {
    expect(computeHeroMobileHeadingMaxAreaPx2(0)).toBe(0);
    expect(computeHeroMobileHeadingMaxAreaPx2(32)).toBe(0);
  });
});
