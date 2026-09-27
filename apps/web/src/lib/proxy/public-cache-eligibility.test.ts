import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import {
  isCacheablePublicStorefrontDocument,
  isCacheablePublicStorefrontDocumentRequest,
  isStorefrontHomeDocument,
  shouldSetStorefrontDocumentCacheControl,
} from './public-cache-eligibility';

describe('public storefront cache eligibility', () => {
  it('fails closed for missing requests and non-document methods', () => {
    expect(isCacheablePublicStorefrontDocumentRequest(undefined)).toBe(false);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(
        isCacheablePublicStorefrontDocumentRequest(
          new NextRequest('https://ogabassey.com/products/iphone', { method })
        )
      ).toBe(false);
    }
  });

  it('admits an explicit document navigation', () => {
    expect(
      isCacheablePublicStorefrontDocumentRequest(
        new NextRequest('https://ogabassey.com/products/iphone', {
          headers: { 'sec-fetch-dest': 'document' },
        })
      )
    ).toBe(true);
  });

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

  it.each([
    ['RSC', { rsc: '1' }],
    ['router prefetch', { 'next-router-prefetch': '1' }],
    ['router state tree', { 'next-router-state-tree': 'tree' }],
    ['non-document destination', { 'sec-fetch-dest': 'empty' }],
  ])('rejects header-only %s requests from public HTML caching', (_, headers) => {
    expect(
      isCacheablePublicStorefrontDocumentRequest(
        new NextRequest('https://ogabassey.com/products/iphone', { headers })
      )
    ).toBe(false);
  });

  it('admits only query-free document GET and HEAD requests', () => {
    expect(
      isCacheablePublicStorefrontDocumentRequest(
        new NextRequest('https://ogabassey.com/products/iphone')
      )
    ).toBe(true);
    expect(
      isCacheablePublicStorefrontDocumentRequest(
        new NextRequest('https://ogabassey.com/products/iphone', {
          method: 'HEAD',
        })
      )
    ).toBe(true);
    expect(
      isCacheablePublicStorefrontDocumentRequest(
        new NextRequest('https://ogabassey.com/products/iphone?_rsc=hash')
      )
    ).toBe(false);
  });
});
