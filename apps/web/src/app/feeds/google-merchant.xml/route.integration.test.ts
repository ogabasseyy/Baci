import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MerchantNotFoundError } from '@/lib/feed-identifier';

const mockResolveStorefrontMerchantFromRequest = vi.fn();
const mockResolveFeedMerchant = vi.fn();
const mockGetCachedGoogleMerchantFeedData = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('@/lib/storefront-merchant', () => ({
  resolveStorefrontMerchantFromRequest: (...args: unknown[]) =>
    mockResolveStorefrontMerchantFromRequest(...args),
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

vi.mock('@/lib/cache-headers', () => ({
  CACHE_HEADERS: {
    LONG: {
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  },
}));

vi.mock('@/app/api/feed/google-merchant/feed-data', () => ({
  getCachedGoogleMerchantFeedData: (...args: unknown[]) =>
    mockGetCachedGoogleMerchantFeedData(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: (payload: unknown) => mockLoggerError(payload),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();

  mockResolveStorefrontMerchantFromRequest.mockResolvedValue({
    success: true,
    merchant: {
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'Ogabassey',
    },
  });

  mockResolveFeedMerchant.mockResolvedValue({
    id: 'merchant-1',
    slug: 'ogabassey',
    business_name: 'Ogabassey',
    country: 'NG',
    payout_currency: 'NGN',
  });

  mockGetCachedGoogleMerchantFeedData.mockResolvedValue({
    custom_domain: 'ogabassey.com',
    slug: 'ogabassey',
    products: [
      {
        id: 'product-1',
        name: 'Riversong Motive 5T Smart Watch',
        description: 'Smart watch',
        slug: 'riversong-motive-5t-smart-watch',
        category: 'Smartwatches',
        categories: {
          name: 'Smartwatches',
          slug: 'smartwatches',
        },
        price: 30_600,
        condition: 'new',
        // Baci storefront feeds treat unmanaged stock as unlimited inventory.
        stock: 0,
        stock_quantity: 0,
        manage_stock: false,
      },
    ],
    imageManifest: {
      'product-1': [
        {
          verified_url: 'https://cdn.ogabassey.com/products/watch.jpg',
          verified_format: 'jpeg',
          status: 'verified',
          is_primary: true,
          position: 0,
        },
      ],
    },
  });
});

describe('GET /feeds/google-merchant.xml integration', () => {
  it('uses the shared Google Merchant feed service and returns generated XML', async () => {
    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest('https://ogabassey.com/feeds/google-merchant.xml', {
        headers: { host: 'ogabassey.com' },
      })
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/xml');
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain(
      '<g:link>https://ogabassey.com/smartwatches/riversong-motive-5t-smart-watch</g:link>'
    );
    expect(xml).toContain('<g:availability>in_stock</g:availability>');
    expect(xml).toContain('<g:quantity>9999</g:quantity>');
    expect(mockResolveFeedMerchant).toHaveBeenCalledWith('ogabassey', true);
    expect(mockGetCachedGoogleMerchantFeedData).toHaveBeenCalledWith(
      'merchant-1',
      'ogabassey'
    );
  });

  it('returns 404 when feed merchant resolution fails', async () => {
    mockResolveFeedMerchant.mockRejectedValue(
      new MerchantNotFoundError('unknown-merchant')
    );
    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest('https://ogabassey.com/feeds/google-merchant.xml', {
        headers: { host: 'ogabassey.com' },
      })
    );
    const xml = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/xml');
    expect(xml).toContain('<error>');
    expect(xml).toContain('<message>Merchant not found</message>');
    expect(mockGetCachedGoogleMerchantFeedData).not.toHaveBeenCalled();
  });

  it('returns 500 when feed data loading fails', async () => {
    mockGetCachedGoogleMerchantFeedData.mockRejectedValue(
      new Error('feed data failed')
    );
    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest('https://ogabassey.com/feeds/google-merchant.xml', {
        headers: { host: 'ogabassey.com' },
      })
    );
    const xml = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/xml');
    expect(xml).toContain('<error>');
    expect(xml).toContain('<message>Failed to generate feed</message>');
  });

  it('returns 400 when storefront host validation fails before feed generation', async () => {
    mockResolveStorefrontMerchantFromRequest.mockResolvedValue({
      success: false,
      status: 400,
      error: 'Invalid storefront host',
    });
    const { GET } = await import('./route');

    const response = await GET(
      new NextRequest('https://usebaci.com/feeds/google-merchant.xml', {
        headers: { host: '<script>' },
      })
    );
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toContain('application/xml');
    expect(body).toContain('<message>Invalid storefront host</message>');
    expect(mockResolveFeedMerchant).not.toHaveBeenCalled();
  });
});
