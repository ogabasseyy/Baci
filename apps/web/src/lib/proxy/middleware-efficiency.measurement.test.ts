import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Offline stage measurements: never resolve a real merchant or provider.
vi.mock('@/lib/domain-cache-simple', () => ({
  getCustomDomainForSlug: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue(null),
}));
vi.mock('./blog-preflight', () => ({
  resolveStorefrontBlogPostHardStatus: vi.fn().mockResolvedValue(null),
  resolveStorefrontBlogListingHardStatus: vi.fn().mockResolvedValue(null),
}));
vi.mock('./compare-preflight', () => ({
  resolveStorefrontComparePageHardStatus: vi.fn().mockResolvedValue(null),
}));
vi.mock('./pdp-preflight', () => ({
  resolveStorefrontPdpCanonicalRedirect: vi.fn().mockResolvedValue({
    response: null,
    skipHardNotFound: false,
  }),
  resolveStorefrontPdpHardNotFound: vi.fn().mockResolvedValue(null),
}));

import { getCustomDomainForSlug } from '@/lib/domain-cache-simple';
import {
  resolveStorefrontBlogListingHardStatus,
  resolveStorefrontBlogPostHardStatus,
} from './blog-preflight';
import { resolveStorefrontComparePageHardStatus } from './compare-preflight';
import * as normalization from './path-normalization';
import {
  resolveStorefrontPdpCanonicalRedirect,
  resolveStorefrontPdpHardNotFound,
} from './pdp-preflight';
import { runPlatformCanonicalRoutingStage } from './platform-routing';
import { runStorefrontPreflight } from './storefront-preflight';
import { runSubdomainRouting } from './subdomain-routing';

const REQUESTS_PER_CLASS = 100;
// Copy this test unchanged into the documented baseline checkout to compare.
const baseline = process.env.BACI_MIDDLEWARE_MEASURE_BASELINE === '1';
const preflightHelpers = [
  resolveStorefrontBlogPostHardStatus,
  resolveStorefrontBlogListingHardStatus,
  resolveStorefrontComparePageHardStatus,
  resolveStorefrontPdpCanonicalRedirect,
  resolveStorefrontPdpHardNotFound,
];

describe('offline middleware stage call budget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Network access is forbidden in this measurement');
      })
    );
  });

  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    ['GET', '/api/orders', false],
    ['POST', '/api/orders', false],
    ['POST', '/products/phone', false],
    ['GET', '/products/phone', true],
    ['HEAD', '/products/phone', true],
  ] as const)('%s %s forward-domain call budget', async (method, pathname, lookup) => {
    for (let index = 0; index < REQUESTS_PER_CLASS; index += 1) {
      const response = await runSubdomainRouting(
        new NextRequest(`https://shop.usebaci.com${pathname}`, { method }),
        pathname,
        'shop.usebaci.com',
        'Mozilla',
        'shop'
      );
      expect(response).not.toBeNull();
    }
    expect(getCustomDomainForSlug).toHaveBeenCalledTimes(
      baseline || lookup ? REQUESTS_PER_CLASS : 0
    );
  });

  it('canonical ASCII avoids both real normalization helpers', () => {
    const cacheSafe = vi.spyOn(
      normalization,
      'normalizeCacheSafeStorefrontPathname'
    );
    const lowercase = vi.spyOn(normalization, 'lowercaseStorefrontPathname');
    for (let index = 0; index < REQUESTS_PER_CLASS; index += 1) {
      expect(
        runPlatformCanonicalRoutingStage(
          new NextRequest('https://usebaci.com/products/phone'),
          '/products/phone',
          'usebaci.com'
        )
      ).toBeNull();
    }
    const expected = baseline ? REQUESTS_PER_CLASS : 0;
    expect(cacheSafe).toHaveBeenCalledTimes(expected);
    expect(lowercase).toHaveBeenCalledTimes(expected);
  });

  it.each<{
    method: string;
    headers: Record<string, string>;
    document: boolean;
  }>([
    { method: 'GET', headers: { rsc: '1' }, document: false },
    { method: 'GET', headers: { 'next-router-prefetch': '' }, document: false },
    {
      method: 'GET',
      headers: { 'next-router-state-tree': '' },
      document: false,
    },
    { method: 'GET', headers: { 'sec-fetch-dest': 'empty' }, document: false },
    { method: 'POST', headers: {}, document: false },
    {
      method: 'GET',
      headers: { 'sec-fetch-dest': 'document' },
      document: true,
    },
    {
      method: 'HEAD',
      headers: { 'sec-fetch-dest': 'document' },
      document: true,
    },
  ])('$method $headers preflight dispatch budget', async ({
    method,
    headers,
    document,
  }) => {
    for (let index = 0; index < REQUESTS_PER_CLASS; index += 1) {
      expect(
        await runStorefrontPreflight({
          request: new NextRequest('https://shop.example/products/phone', {
            method,
            headers,
          }),
          pathname: '/products/phone',
          hostname: 'shop.example',
          userAgent: 'Mozilla',
          merchantIdentifier: 'shop',
        })
      ).toBeNull();
    }
    const expected = baseline || document ? REQUESTS_PER_CLASS : 0;
    expect(
      preflightHelpers.map((helper) => vi.mocked(helper).mock.calls.length)
    ).toEqual(Array<number>(5).fill(expected));
  });
});
