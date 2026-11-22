// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetMerchantByIdentifier = vi.fn();
const mockGetCachedGoogleMerchantFeedData = vi.fn();
const mockGetCachedOpenAIFeedData = vi.fn();
const mockGetCachedGooglePlacesReviews = vi.fn();
const mockLoggerError = vi.fn();

const ROUTE_TEST_TIMEOUT_MS = 60_000;

vi.mock('server-only', () => ({}));

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: (...args: unknown[]) =>
    mockGetMerchantByIdentifier(...args),
}));

vi.mock('@/lib/get-merchant-by-identifier-or-alias', () => ({
  getMerchantByIdentifierOrAlias: (...args: unknown[]) =>
    mockGetMerchantByIdentifier(...args),
}));

vi.mock('@/app/api/feed/google-merchant/feed-data', () => ({
  getCachedGoogleMerchantFeedData: (...args: unknown[]) =>
    mockGetCachedGoogleMerchantFeedData(...args),
}));

vi.mock('@/app/api/feed/openai/feed-data', () => ({
  getCachedOpenAIFeedData: (...args: unknown[]) =>
    mockGetCachedOpenAIFeedData(...args),
}));

vi.mock('@/lib/google-places-reviews', () => ({
  getCachedGooglePlacesReviews: (...args: unknown[]) =>
    mockGetCachedGooglePlacesReviews(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: (...args: unknown[]) => mockLoggerError(...args),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

function baseMerchant() {
  return {
    id: 'merchant-1',
    business_name: 'Ogabassey',
    business_type: 'electronics',
    custom_domain: 'ogabassey.com',
    slug: 'ogabassey',
    support_email: 'support@ogabassey.com',
    pages: {
      privacy: 'Privacy policy content',
      terms: 'Terms of service content',
    },
    trust_profile: {
      return_policy: {
        summary: '7-day returns.',
        window_days: 7,
      },
      shipping_policy: {
        regions: ['NG'],
        summary: 'Nationwide shipping.',
      },
    },
  };
}

describe('GET /agent-trust.json cache headers and Places key guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'usebaci.com');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-places-key');

    mockGetMerchantByIdentifier.mockResolvedValue(baseMerchant());
    mockGetCachedOpenAIFeedData.mockResolvedValue({
      products: [
        {
          id: 'product-1',
          name: 'Samsung Galaxy S25',
          description: 'Flagship phone',
          price: 900000,
          currency: 'NGN',
          stock: 4,
          image_link: 'https://cdn.ogabassey.com/s25.jpg',
          condition: 'new',
          updated_at: '2026-05-10T00:00:00.000Z',
        },
      ],
    });
    mockGetCachedGoogleMerchantFeedData.mockResolvedValue({
      products: [],
    });
    mockGetCachedGooglePlacesReviews.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it(
    'skips Google Places enrichment cleanly when GOOGLE_PLACES_API_KEY is missing',
    async () => {
      vi.stubEnv('GOOGLE_PLACES_API_KEY', '');
      vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
      mockGetMerchantByIdentifier.mockResolvedValueOnce({
        ...baseMerchant(),
        feature_settings: {
          google_place_id: 'ChIJ1234',
          google_reviews_enabled: true,
        },
      });

      const { GET } = await import('./route');
      const response = await GET(
        new Request('https://ogabassey.com/agent-trust.json', {
          headers: { host: 'ogabassey.com' },
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
      expect(response.headers.get('Vercel-CDN-Cache-Control')).toBe(
        'public, s-maxage=1800, stale-while-revalidate=86400'
      );
      expect(mockGetCachedGooglePlacesReviews).not.toHaveBeenCalled();
      expect(mockLoggerError).not.toHaveBeenCalled();
      expect(body.trust.merchantReviewAuthority).toMatchObject({
        placeId: 'ChIJ1234',
        source: 'google_maps',
      });
    },
    ROUTE_TEST_TIMEOUT_MS
  );

  it('sets short public and CDN cache headers on 404 responses', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://usebaci.com/agent-trust.json', {
        headers: { host: 'usebaci.com' },
      })
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(response.headers.get('Vercel-CDN-Cache-Control')).toBe(
      'public, s-maxage=1800, stale-while-revalidate=86400'
    );
  });

  it('sets no-store cache headers on 500 error responses', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetMerchantByIdentifier.mockRejectedValueOnce(new Error('db down'));

    try {
      const { GET } = await import('./route');
      const response = await GET(
        new Request('https://ogabassey.com/agent-trust.json', {
          headers: { host: 'ogabassey.com' },
        })
      );

      expect(response.status).toBe(500);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
