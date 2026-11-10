import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MerchantNotFoundError } from '@/lib/feed-identifier';

const mockGetCachedOpenAIFeedData = vi.fn();
const mockGetMerchantByIdentifier = vi.fn();
const mockGetCurrentSlugForAlias = vi.fn();
const mockResolveFeedMerchant = vi.fn();

vi.mock('@/env', () => ({
  getRootDomain: vi.fn(() => 'usebaci.com'),
}));

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: (...args: unknown[]) =>
    mockGetMerchantByIdentifier(...args),
}));

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: (...args: unknown[]) =>
    mockGetCurrentSlugForAlias(...args),
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
    SHORT: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  },
}));

vi.mock('./feed-data', () => ({
  getCachedOpenAIFeedData: (...args: unknown[]) =>
    mockGetCachedOpenAIFeedData(...args),
}));

function storefrontRequest(path: string) {
  return new NextRequest(`https://ogabassey.com${path}`, {
    headers: { host: 'ogabassey.com' },
  });
}

function rootRequest(path: string) {
  return new NextRequest(`https://usebaci.com${path}`, {
    headers: { host: 'usebaci.com' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();

  mockGetMerchantByIdentifier.mockResolvedValue({
    id: '11111111-1111-4111-8111-111111111111',
    business_name: 'Ogabassey',
    country: 'NG',
    payout_currency: 'NGN',
    slug: 'ogabassey',
    custom_domain: 'ogabassey.com',
  });
  mockGetCurrentSlugForAlias.mockResolvedValue(null);
  mockResolveFeedMerchant.mockResolvedValue({
    id: '11111111-1111-4111-8111-111111111111',
    business_name: 'Ogabassey',
    country: 'NG',
    payout_currency: 'NGN',
    slug: 'ogabassey',
  });
  mockGetCachedOpenAIFeedData.mockResolvedValue({
    products: [
      {
        id: 'prod-1',
        name: 'Test Phone',
        description: 'A phone',
        slug: 'test-phone',
        price: 50000,
        stock: 5,
        images: ['https://cdn.example.com/phone.jpg'],
        updated_at: '2026-03-24T00:00:00.000Z',
      },
    ],
  });
});

describe('GET /api/feed/openai host-scoped merchant inference', () => {
  it('infers the merchant from a storefront custom domain when no identifier is provided', async () => {
    const { GET } = await import('./route');

    const response = await GET(
      storefrontRequest('/api/feed/openai?format=current')
    );
    const line = (await response.text()).trim().split('\n')[0];
    const parsed = JSON.parse(line);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300'
    );
    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
    // Host-inferred requests are still gated through resolveFeedMerchant so
    // unpublished storefronts cannot be served via host inference. Lookup is
    // by stable UUID to avoid stale cached host->slug mappings resolving the
    // wrong merchant after a slug is recycled.
    expect(mockResolveFeedMerchant).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      false
    );
    expect(mockGetCachedOpenAIFeedData).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111'
    );
    expect(parsed.url).toBe('https://ogabassey.com/products/test-phone');
  });

  it('returns 404 when the host-inferred merchant is unpublished', async () => {
    // Host inference resolves a merchant record (cached_data does not gate on
    // is_published — it serves "Coming Soon" pages), but resolveFeedMerchant's
    // RPC enforces is_published/is_platform_admin and returns no rows for an
    // unpublished storefront, which surfaces as MerchantNotFoundError.
    mockResolveFeedMerchant.mockRejectedValue(
      new MerchantNotFoundError('11111111-1111-4111-8111-111111111111')
    );

    const { GET } = await import('./route');

    const response = await GET(
      storefrontRequest('/api/feed/openai?format=current')
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Merchant not found');
    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
    expect(mockResolveFeedMerchant).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      false
    );
    expect(mockGetCachedOpenAIFeedData).not.toHaveBeenCalled();
  });

  it('still requires a merchant identifier on the platform host', async () => {
    const { GET } = await import('./route');

    const response = await GET(rootRequest('/api/feed/openai?format=current'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe(
      'merchant_id or merchant_slug parameter is required'
    );
    expect(mockGetMerchantByIdentifier).not.toHaveBeenCalled();
    expect(mockGetCachedOpenAIFeedData).not.toHaveBeenCalled();
  });

  it('returns 404 when explicit platform merchant lookup misses', async () => {
    mockResolveFeedMerchant.mockRejectedValue(
      new MerchantNotFoundError('missing')
    );

    const { GET } = await import('./route');

    const response = await GET(
      rootRequest('/api/feed/openai?merchant_slug=missing&format=current')
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Merchant not found');
    expect(mockGetMerchantByIdentifier).not.toHaveBeenCalled();
    expect(mockGetCachedOpenAIFeedData).not.toHaveBeenCalled();
  });

  it('returns 400 when host-scoped merchant inference cannot resolve the storefront', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue(null);

    const { GET } = await import('./route');

    const response = await GET(
      storefrontRequest('/api/feed/openai?format=current')
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('No storefront found for the given host');
    expect(mockGetCurrentSlugForAlias).toHaveBeenCalledWith('ogabassey.com');
    expect(mockResolveFeedMerchant).not.toHaveBeenCalled();
    expect(mockGetCachedOpenAIFeedData).not.toHaveBeenCalled();
  });

  it('returns 500 when host-scoped merchant inference throws', async () => {
    mockGetMerchantByIdentifier.mockRejectedValue(new Error('lookup failed'));

    const { GET } = await import('./route');

    const response = await GET(
      storefrontRequest('/api/feed/openai?format=current')
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Failed to generate feed');
    expect(mockResolveFeedMerchant).not.toHaveBeenCalled();
    expect(mockGetCachedOpenAIFeedData).not.toHaveBeenCalled();
  });
});
