import { describe, expect, it } from 'vitest';
import {
  getStorefrontPublicationResponseCacheTag,
  getStorefrontSlugFromRequest,
} from './public-cache-policy';

describe('storefront public cache policy lookup', () => {
  it('derives a merchant slug from platform-prefixed and subdomain requests', () => {
    expect(
      getStorefrontSlugFromRequest('/ogabassey/products/iphone', 'usebaci.com')
    ).toBe('ogabassey');
    expect(
      getStorefrontSlugFromRequest('/products/iphone', 'ogabassey.usebaci.com')
    ).toBe('ogabassey');
  });

  it('does not create a publication cache tag for local or reserved platform paths', () => {
    expect(
      getStorefrontPublicationResponseCacheTag(
        '/ogabassey/products',
        'localhost'
      )
    ).toBeNull();
    expect(
      getStorefrontPublicationResponseCacheTag('/checkout', 'usebaci.com')
    ).toBeNull();
  });
});
