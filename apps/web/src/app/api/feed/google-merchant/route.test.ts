import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveFeedMerchant = vi.fn();
const mockGenerateGoogleMerchantFeed = vi.fn();
const mockGetCachedGoogleMerchantFeedData = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

vi.mock('@/lib/feed-identifier', () => {
  class _MerchantNotFoundError extends Error {
    constructor(identifier: string) {
      super(`Merchant not found: ${identifier}`);
      this.name = 'MerchantNotFoundError';
    }
  }
  return {
    MerchantNotFoundError: _MerchantNotFoundError,
    resolveFeedMerchant: (...args: unknown[]) =>
      mockResolveFeedMerchant(...args),
  };
});

vi.mock('./feed-data', () => ({
  getCachedGoogleMerchantFeedData: (...args: unknown[]) =>
    mockGetCachedGoogleMerchantFeedData(...args),
}));

vi.mock('@/lib/cache-headers', () => ({
  CACHE_HEADERS: {
    LONG: {
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  },
}));

vi.mock('./feed-builder', () => ({
  generateGoogleMerchantFeed: (...args: unknown[]) =>
    mockGenerateGoogleMerchantFeed(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: (payload: unknown) => mockLoggerError(payload),
  },
}));

import { MerchantNotFoundError } from '@/lib/feed-identifier';

function makeRequest(path: string) {
  return new NextRequest(`https://example.com${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();

  mockResolveFeedMerchant.mockResolvedValue({
    id: 'merchant-1',
    business_name: 'Ogabassey',
    country: 'NG',
    payout_currency: 'NGN',
    slug: 'ogabassey',
  });

  mockGetCachedGoogleMerchantFeedData.mockResolvedValue({
    custom_domain: 'ogabassey.com',
    slug: 'ogabassey',
    products: [
      {
        id: 'product-1',
        name: 'Phone',
        description: 'Good phone',
        slug: 'phone',
        price: 100,
        stock: 2,
        updated_at: '2026-03-17T00:00:00.000Z',
      },
    ],
    imageManifest: {
      'product-1': [
        {
          verified_url:
            'https://cdn.ogabassey.com/core-assets/products/phone.jpg',
          verified_format: 'jpeg',
          status: 'verified',
          is_primary: true,
          position: 0,
        },
      ],
    },
  });

  mockGenerateGoogleMerchantFeed.mockReturnValue('<rss />');
});

describe('GET /api/feed/google-merchant', () => {
  it('returns 400 when merchant identifier is missing', async () => {
    const { GET } = await import('./route');

    const response = await GET(makeRequest('/api/feed/google-merchant'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe(
      'merchant_id or merchant_slug parameter is required'
    );
  });

  it('returns 400 when both merchant_id and merchant_slug are provided', async () => {
    const { GET } = await import('./route');

    const response = await GET(
      makeRequest(
        '/api/feed/google-merchant?merchant_id=00000000-0000-4000-8000-000000000001&merchant_slug=ogabassey'
      )
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe(
      'Provide exactly one of merchant_id or merchant_slug, not both'
    );
  });

  it('uses the primary domain from feed data for canonical product links', async () => {
    const { GET } = await import('./route');

    const response = await GET(
      makeRequest('/api/feed/google-merchant?merchant_slug=ogabassey')
    );

    expect(response.status).toBe(200);
    expect(mockGenerateGoogleMerchantFeed).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        id: 'merchant-1',
        slug: 'ogabassey',
        custom_domain: 'ogabassey.com',
      }),
      'https://ogabassey.com',
      expect.any(Object)
    );
  });

  it('returns valid Google Merchant XML with correct content-type for successful request', async () => {
    mockResolveFeedMerchant.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Ogabassey',
      country: 'NG',
      payout_currency: 'NGN',
      gmc_variants_enabled: false,
    });
    mockGetCachedGoogleMerchantFeedData.mockResolvedValue({
      custom_domain: 'ogabassey.com',
      slug: 'ogabassey',
      imageManifest: {},
      products: [{ id: 'product-1', name: 'Watch', price: 30_600 }],
    });
    mockGenerateGoogleMerchantFeed.mockReturnValue(
      '<?xml version="1.0" encoding="UTF-8"?><rss><channel><item><g:id>product-1</g:id></item></channel></rss>'
    );
    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest(
        'https://ogabassey.com/api/feed/google-merchant?merchant_slug=ogabassey',
        { headers: { host: 'ogabassey.com' } }
      )
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/xml');
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toBe(
      'public, s-maxage=3600, stale-while-revalidate=86400'
    );
    expect(response.headers.get('CDN-Cache-Control')).toBe(
      'public, s-maxage=3600, stale-while-revalidate=86400'
    );
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=300, stale-while-revalidate=86400'
    );
    expect(xml).toContain('<rss');
    expect(xml).toContain('<g:id>product-1</g:id>');
    expect(mockGenerateGoogleMerchantFeed).toHaveBeenCalledWith(
      [{ id: 'product-1', name: 'Watch', price: 30_600 }],
      expect.objectContaining({
        id: 'merchant-1',
        slug: 'ogabassey',
        custom_domain: 'ogabassey.com',
      }),
      'https://ogabassey.com',
      {}
    );
  });

  it('returns 404 when merchant is not found', async () => {
    mockResolveFeedMerchant.mockRejectedValue(
      new MerchantNotFoundError('ogabassey')
    );
    const { GET } = await import('./route');

    const response = await GET(
      makeRequest('/api/feed/google-merchant?merchant_slug=ogabassey')
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Merchant not found');
    expect(mockGenerateGoogleMerchantFeed).not.toHaveBeenCalled();
  });

  it('returns 500 when feed data fetch fails', async () => {
    mockGetCachedGoogleMerchantFeedData.mockRejectedValue(
      new Error('Failed to fetch products')
    );
    const { GET } = await import('./route');

    const response = await GET(
      makeRequest('/api/feed/google-merchant?merchant_slug=ogabassey')
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to generate feed');
    expect(mockGenerateGoogleMerchantFeed).not.toHaveBeenCalled();
  });

  it('returns 200 when using merchant_id parameter', async () => {
    const { GET } = await import('./route');

    const response = await GET(
      makeRequest(
        '/api/feed/google-merchant?merchant_id=00000000-0000-4000-8000-000000000001'
      )
    );

    expect(response.status).toBe(200);
    expect(mockResolveFeedMerchant).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      false
    );
  });

  it('passes merchant id and slug to cached data fetcher', async () => {
    const { GET } = await import('./route');

    await GET(makeRequest('/api/feed/google-merchant?merchant_slug=ogabassey'));

    expect(mockGetCachedGoogleMerchantFeedData).toHaveBeenCalledWith(
      'merchant-1',
      'ogabassey'
    );
  });

  it('passes an empty product list through to the feed builder', async () => {
    mockGetCachedGoogleMerchantFeedData.mockResolvedValue({
      custom_domain: 'ogabassey.com',
      slug: 'ogabassey',
      products: [],
      imageManifest: {},
    });
    const { GET } = await import('./route');

    const response = await GET(
      makeRequest('/api/feed/google-merchant?merchant_slug=ogabassey')
    );

    expect(response.status).toBe(200);
    expect(mockGenerateGoogleMerchantFeed).toHaveBeenCalledWith(
      [],
      expect.any(Object),
      'https://ogabassey.com',
      expect.any(Object)
    );
  });
});
