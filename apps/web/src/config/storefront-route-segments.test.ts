import { describe, expect, it } from 'vitest';
import { shouldStripRetiredSlugPrefix } from './storefront-route-segments';

describe('shouldStripRetiredSlugPrefix', () => {
  it('preserves the exact live unlock-orders page path', () => {
    expect(shouldStripRetiredSlugPrefix('unlock-orders', 1)).toBe(false);
  });

  it('allows a suffixed retired unlock-orders slug to redirect', () => {
    expect(shouldStripRetiredSlugPrefix('unlock-orders', 2)).toBe(true);
  });

  it('preserves other live storefront route roots', () => {
    expect(shouldStripRetiredSlugPrefix('blog', 1)).toBe(false);
  });

  it('strips a retired slug that does not collide with a live route', () => {
    expect(shouldStripRetiredSlugPrefix('yodhashop', 2)).toBe(true);
  });

  it('preserves platform routes on custom domains', () => {
    expect(shouldStripRetiredSlugPrefix('auth', 2)).toBe(false);
  });
});
