import { describe, expect, it } from 'vitest';
import {
  getRouteType,
  getStorefrontContentSegments,
  isStorefrontNestedListingPath,
  isStorefrontProductPagePath,
  shouldPartitionStorefrontMetadataCache,
} from './routing-policy';

describe('proxy routing policy', () => {
  it('separates platform slug prefixes from custom-domain storefront paths', () => {
    expect(
      getStorefrontContentSegments(
        '/ogabassey/products/iphone',
        'usebaci.com',
        'storefront'
      )
    ).toEqual(['products', 'iphone']);
    expect(
      getStorefrontContentSegments(
        '/products/iphone',
        'ogabassey.com',
        'storefront'
      )
    ).toEqual(['products', 'iphone']);
    expect(
      isStorefrontProductPagePath(
        '/ogabassey/phones/iphone',
        'usebaci.com',
        'storefront'
      )
    ).toBe(true);
  });

  it('does not partition non-HTML or SEO listing routes as PDP metadata', () => {
    expect(
      isStorefrontNestedListingPath(
        '/ogabassey/phones/compare/x',
        'usebaci.com',
        'storefront'
      )
    ).toBe(true);
    expect(
      shouldPartitionStorefrontMetadataCache(
        '/ogabassey/products/iphone/opengraph-image',
        'usebaci.com',
        'storefront'
      )
    ).toBe(false);
    expect(getRouteType('/api/orders')).toBe('api');
  });
});
