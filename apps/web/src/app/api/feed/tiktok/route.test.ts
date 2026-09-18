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
        name: 'Redmi A7',
        description: '<p>Budget phone</p>',
        slug: 'redmi-a7',
        price: 120_540,
        brand: 'Redmi',
        stock: 5,
        stock_quantity: 5,
        manage_stock: true,
        category: 'Smartphones',
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
        {
          verified_url: 'https://cdn.example.com/redmi-a7-side.jpg',
          verified_format: 'jpeg',
          status: 'verified',
          is_primary: false,
          position: 1,
        },
      ],
    },
  });
});

describe('GET /api/feed/tiktok', () => {
  it('returns 400 when merchant identifier is missing', async () => {
    const { GET } = await import('./route');
    const response = await GET(makeRequest('/api/feed/tiktok'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBeDefined();
    expect(mockResolveFeedMerchant).not.toHaveBeenCalled();
    expect(mockGetCachedGoogleMerchantFeedData).not.toHaveBeenCalled();
  });

  it('uses the verified Google image manifest for TikTok catalog images', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      makeRequest('/api/feed/tiktok?merchant_slug=ogabassey')
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(mockResolveFeedMerchant).toHaveBeenCalledWith('ogabassey', true);
    expect(mockGetCachedGoogleMerchantFeedData).toHaveBeenCalledWith(
      'merchant-1',
      'ogabassey'
    );
    expect(text).toContain(
      '<image_link>https://cdn.example.com/redmi-a7-front.jpg</image_link>'
    );
    expect(text).toContain(
      '<additional_image_link>https://cdn.example.com/redmi-a7-side.jpg</additional_image_link>'
    );
    expect(text).not.toContain('<image_link></image_link>');
  });

  it('excludes offer-claimed images from TikTok catalog images', async () => {
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
          offers: [
            {
              id: 'offer-used',
              condition: 'used',
              price: 100_000,
              images: ['https://cdn.example.com/redmi-a7-side.jpg'],
            },
          ],
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
          {
            verified_url: 'https://cdn.example.com/redmi-a7-side.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: false,
            position: 1,
          },
        ],
      },
    });
    const { GET } = await import('./route');
    const response = await GET(
      makeRequest('/api/feed/tiktok?merchant_slug=ogabassey')
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain(
      '<image_link>https://cdn.example.com/redmi-a7-front.jpg</image_link>'
    );
    expect(text).not.toContain('redmi-a7-side.jpg');
  });

  it('ignores image claims from non-emittable offers', async () => {
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
          offers: [
            {
              id: 'offer-zero',
              condition: 'used',
              price: 0,
              images: ['https://cdn.example.com/redmi-a7-front.jpg'],
            },
          ],
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
    const { GET } = await import('./route');
    const response = await GET(
      makeRequest('/api/feed/tiktok?merchant_slug=ogabassey')
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain(
      '<image_link>https://cdn.example.com/redmi-a7-front.jpg</image_link>'
    );
  });

  it('emits the resolved merchant currency (not a hardcoded default) in item prices', async () => {
    mockResolveFeedMerchant.mockResolvedValue({
      id: 'merchant-1',
      business_name: 'Accra Store',
      country: 'GH',
      payout_currency: 'GHS',
      slug: 'accra-store',
    });

    const { GET } = await import('./route');
    const response = await GET(
      makeRequest('/api/feed/tiktok?merchant_slug=accra-store')
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain('<price>120540.00 GHS</price>');
    expect(text).not.toContain('USD');
  });

  it('returns 404 when the merchant cannot be resolved', async () => {
    mockResolveFeedMerchant.mockRejectedValue(
      new MockMerchantNotFoundError('missing')
    );

    const { GET } = await import('./route');
    const response = await GET(
      makeRequest('/api/feed/tiktok?merchant_slug=unknown')
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Merchant not found');
  });

  it('returns 500 when the feed data fetch fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetCachedGoogleMerchantFeedData.mockRejectedValue(
      new Error('Database error')
    );

    const { GET } = await import('./route');
    const response = await GET(
      makeRequest('/api/feed/tiktok?merchant_slug=ogabassey')
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to generate feed');
    expect(consoleSpy).toHaveBeenCalledWith(
      'TIKTOK_FEED_GENERATION_ERROR:',
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });
});
