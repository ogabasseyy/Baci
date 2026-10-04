import { describe, expect, it } from 'vitest';
import {
  PILOT_LAB_STORES,
  pilotLabStoreBasePath,
  pilotLabStoreBySlug,
} from './lab-store-registry';

describe('pilot lab store table', () => {
  it('covers the four sample stores with their selected slots', () => {
    expect(PILOT_LAB_STORES.map((store) => store.slug)).toEqual([
      'omnimart',
      'squishyland',
      'zorvexa',
      'ogabassey',
    ]);
    expect(PILOT_LAB_STORES.flatMap((store) => store.slots)).toHaveLength(6);
    expect(pilotLabStoreBySlug('omnimart')?.slots).toEqual([
      'header-logo',
      'product-card',
    ]);
    expect(pilotLabStoreBySlug('squishyland')?.slots).toEqual(['product-card']);
    expect(pilotLabStoreBySlug('zorvexa')?.slots).toEqual([
      'header-logo',
      'product-card',
    ]);
    expect(pilotLabStoreBySlug('ogabassey')?.slots).toEqual([
      'mobile-hero-slide-0',
    ]);
  });

  it('declares the CSS hero banners as uncovered consumers (plan §3 rows 2, 5)', () => {
    // The builder CSS-background heroes bypass the shared loader and have
    // no frozen sample: declared here so store pages report them instead
    // of silently excluding them from every denominator.
    const uncovered = PILOT_LAB_STORES.flatMap((store) =>
      store.uncoveredSlots.map((slot) => [store.slug, slot.slotId] as const)
    );
    expect(uncovered).toEqual([
      ['omnimart', 'hero-banner'],
      ['squishyland', 'hero-banner'],
    ]);
    for (const store of PILOT_LAB_STORES) {
      for (const slot of store.uncoveredSlots) {
        expect(slot.consumer).toMatch(/hero-component/);
        expect(slot.reason.length).toBeGreaterThan(0);
        expect(store.slots).not.toContain(slot.slotId);
      }
    }
  });

  it('resolves unknown slugs to null (route 404s)', () => {
    expect(pilotLabStoreBySlug('dell')).toBeNull();
    expect(pilotLabStoreBySlug('')).toBeNull();
  });

  it('scopes lab hrefs under the store route (never production)', () => {
    const store = pilotLabStoreBySlug('omnimart');
    if (!store) {
      throw new Error('omnimart store is missing from the lab table');
    }
    expect(pilotLabStoreBasePath(store)).toBe('/pilot-lab/store/omnimart');
  });
});
