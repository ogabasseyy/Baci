import { describe, expect, it } from 'vitest';
import { storefrontRouteSegments } from './storefront-route-segments';

describe('storefrontRouteSegments.shouldStripRetiredSlugPrefix', () => {
  it('preserves the exact live unlock-orders page path', () => {
    expect(
      storefrontRouteSegments.shouldStripRetiredSlugPrefix('unlock-orders', 1)
    ).toBe(false);
  });

  it('allows a suffixed retired unlock-orders slug to redirect', () => {
    expect(
      storefrontRouteSegments.shouldStripRetiredSlugPrefix('unlock-orders', 2)
    ).toBe(true);
  });

  it('preserves other live storefront route roots', () => {
    expect(
      storefrontRouteSegments.shouldStripRetiredSlugPrefix('blog', 1)
    ).toBe(false);
  });

  it('strips a retired slug that does not collide with a live route', () => {
    expect(
      storefrontRouteSegments.shouldStripRetiredSlugPrefix('yodhashop', 2)
    ).toBe(true);
  });

  it('preserves platform routes on custom domains', () => {
    expect(
      storefrontRouteSegments.shouldStripRetiredSlugPrefix('auth', 2)
    ).toBe(false);
  });
});
