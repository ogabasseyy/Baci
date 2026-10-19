import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveFeedMerchant = vi.fn();
const mockGetCachedGoogleMerchantFeedData = vi.fn();

class MockMerchantNotFoundError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = 'MerchantNotFoundError';
  }
}

vi.mock('@/lib/feed-identifier', () => ({
  MerchantNotFoundError: MockMerchantNotFoundError,
  resolveFeedMerchant: (...args: unknown[]) => mockResolveFeedMerchant(...args),
}));

vi.mock('../google-merchant/feed-data', () => ({
  getCachedGoogleMerchantFeedData: (...args: unknown[]) =>
    mockGetCachedGoogleMerchantFeedData(...args),
}));

function makeRequest(path: string) {
  return new NextRequest(`https://ogabassey.com${path}`, {
    headers: { host: 'ogabassey.com' },
  });
}

function mockProductFeedData(overrides: Record<string, unknown>) {
  mockGetCachedGoogleMerchantFeedData.mockResolvedValue({
    custom_domain: 'ogabassey.com',
    slug: 'ogabassey',
    products: [
      {
        id: 'product-1',
        name: 'Redmi A7',
        description: '<p>Budget phone</p>',
        slug: 'redmi-a7',
        price: 120_540,
        brand: 'Redmi',
        stock: 5,
        stock_quantity: 5,
        manage_stock: true,
        category: 'Smartphones',
        ...overrides,
      },
    ],
    imageManifest: {
      'product-1': [
        {
          verified_url: 'https://cdn.example.com/redmi-a7-front.jpg',
          verified_format: 'jpeg',
          status: 'verified',
          is_primary: true,
          position: 0,
        },
      ],
    },
  });
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
});

describe('GET /api/feed/tiktok identifiers', () => {
  it('omits whitespace-only parent GTIN/MPN from catalog rows', async () => {
    mockProductFeedData({ gtin: '   ', mpn: '\t ' });
    const { GET } = await import('./route');
    const response = await GET(
      makeRequest('/api/feed/tiktok?merchant_slug=ogabassey')
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).not.toContain('<gtin>');
    expect(text).not.toContain('<mpn>');
  });

  it('trims padded parent GTIN/MPN in catalog rows', async () => {
    mockProductFeedData({
      gtin: '  0123456789012  ',
      mpn: '  MPN-123  ',
    });
    const { GET } = await import('./route');
    const response = await GET(
      makeRequest('/api/feed/tiktok?merchant_slug=ogabassey')
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain('<gtin>0123456789012</gtin>');
    expect(text).toContain('<mpn>MPN-123</mpn>');
  });
});
