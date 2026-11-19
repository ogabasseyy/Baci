import { describe, expect, it } from 'vitest';
import { computeHeroMobileImageMinAreaPx2 } from './compute-hero-mobile-image-min-area-px2';

describe('computeHeroMobileImageMinAreaPx2', () => {
  it('computes the minimum 1:1 slide-0 image painted area for standard mobile viewports', () => {
    expect(computeHeroMobileImageMinAreaPx2(360)).toBeCloseTo(13271.04, 2);
    expect(computeHeroMobileImageMinAreaPx2(390)).toBeCloseTo(16179.84, 2);
    expect(computeHeroMobileImageMinAreaPx2(412)).toBeCloseTo(18496, 2);
  });

  it('clamps non-positive viewport widths to zero area', () => {
    expect(computeHeroMobileImageMinAreaPx2(0)).toBe(0);
    expect(computeHeroMobileImageMinAreaPx2(32)).toBe(0);
  });
});
