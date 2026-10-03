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
