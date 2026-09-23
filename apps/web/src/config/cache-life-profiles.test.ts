import { describe, expect, it } from 'vitest';
import { CACHE_LIFE_PROFILES } from './cache-life-profiles';

describe('CACHE_LIFE_PROFILES', () => {
  it('keeps product and blog data fresh through targeted invalidation with long fallback TTLs', () => {
    expect(CACHE_LIFE_PROFILES.products).toEqual({
      stale: 300,
      revalidate: 1800,
      expire: 86400,
    });
    expect(CACHE_LIFE_PROFILES.blog).toEqual({
      stale: 300,
      revalidate: 3600,
      expire: 86400,
    });
  });

  it('keeps every cache profile bounded by its expiry', () => {
    for (const profile of Object.values(CACHE_LIFE_PROFILES)) {
      expect(profile.revalidate).toBeLessThan(profile.expire);
      expect(profile.stale).toBeLessThan(profile.expire);
    }
  });
});
