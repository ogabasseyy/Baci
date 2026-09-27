import { describe, expect, it } from 'vitest';
import {
  isCacheablePublicStorefrontDocument,
  isStorefrontHomeDocument,
  shouldSetStorefrontDocumentCacheControl,
} from './public-cache-eligibility';

describe('public storefront cache eligibility', () => {
  it('allows anonymous home and PDP documents but rejects query URLs', () => {
    expect(
      isStorefrontHomeDocument('/ogabassey', 'usebaci.com', 'storefront')
    ).toBe(true);
    expect(
      isCacheablePublicStorefrontDocument(
        '/ogabassey/products/iphone',
        'usebaci.com',
        'storefront',
        false
      )
    ).toBe(true);
    expect(
      isCacheablePublicStorefrontDocument(
        '/ogabassey/products/iphone',
        'usebaci.com',
        'storefront',
        true
      )
    ).toBe(false);
  });

  it('keeps private storefront groups eligible for explicit no-store handling', () => {
    expect(
      shouldSetStorefrontDocumentCacheControl(
        '/ogabassey/checkout',
        'usebaci.com',
        'storefront'
      )
    ).toBe(true);
    expect(
      shouldSetStorefrontDocumentCacheControl(
        '/ogabassey/feed.xml',
        'usebaci.com',
        'storefront'
      )
    ).toBe(false);
  });
});
