import { describe, expect, it } from 'vitest';
import { pilotLabFixtureProductSlugs } from './lab-fixture-product-slugs';
import { pilotLabStoreBySlug } from './lab-store-registry';

describe('pilotLabFixtureProductSlugs', () => {
  it('enumerates exactly the fixture slugs the route serves', () => {
    const store = pilotLabStoreBySlug('omnimart');
    if (!store) {
      throw new Error('omnimart store is missing from the lab table');
    }
    // Mounted card + three grid fillers (real href chain) + hero slides.
    // The route test renders actual cards and requires every linked slug
    // to 200, so this pin cannot drift from what browsers prefetch.
    expect([...pilotLabFixtureProductSlugs(store)].sort()).toEqual([
      'lab-filler-four',
      'lab-filler-three',
      'lab-filler-two',
      'lab-hero-slide-0',
      'lab-hero-slide-1',
      'omnimart-lab-product',
    ]);
  });
});
