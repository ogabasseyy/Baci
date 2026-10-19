import { describe, expect, it } from 'vitest';
import {
  STOREFRONT_CACHE,
  STOREFRONT_PUBLIC_CACHE_POLICIES,
} from './storefront-cache';

describe('STOREFRONT_CACHE', () => {
  it('defines storefront product cache durations in seconds', () => {
    expect(STOREFRONT_CACHE.productsSMaxAge).toBe(1800);
    expect(STOREFRONT_CACHE.productsStaleWhileRevalidate).toBe(86400);
  });

  it('defines merchant-specific public document cache policy outside the proxy', () => {
    expect(STOREFRONT_PUBLIC_CACHE_POLICIES).toEqual([
      {
        slug: 'ogabassey',
        durablePdpPurge: false,
        customHostnames: ['ogabassey.com', 'www.ogabassey.com'],
        cacheableCategorySegments: [
          'accessories',
          'audio',
          'childrens-tablets',
          'desktops',
          'earbuds',
          'gaming',
          'gaming-accessories',
          'gaming-consoles',
          'gaming-laptops',
          'gift-cards',
          'laptops',
          'lg-tvs',
          'monitors',
          'nintendo-switch',
          'nintendo-switch-2',
          'playstation-4',
          'playstation-5',
          'portable-gaming',
          'printers',
          'samsung-tvs',
          'smartphones',
          'smartwatches',
          'soundbars',
          'tablets',
          'vr-headsets',
          'wearables',
          'xbox',
        ],
      },
    ]);
  });

  it('keeps cacheable category segments sorted and unique', () => {
    for (const policy of STOREFRONT_PUBLIC_CACHE_POLICIES) {
      const segments = policy.cacheableCategorySegments;
      const sorted = [...segments].sort();
      expect(segments).toEqual(sorted);
      expect(new Set(segments).size).toBe(segments.length);
    }
  });

  it('does not define duplicate public cache policy slugs or custom hostnames', () => {
    const slugs = STOREFRONT_PUBLIC_CACHE_POLICIES.map((policy) =>
      policy.slug.toLowerCase()
    );
    const hostnames = STOREFRONT_PUBLIC_CACHE_POLICIES.flatMap((policy) =>
      policy.customHostnames.map((hostname) => hostname.toLowerCase())
    );

    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(hostnames).size).toBe(hostnames.length);
  });
});
