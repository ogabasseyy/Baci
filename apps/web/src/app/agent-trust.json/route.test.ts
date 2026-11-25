// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetMerchantByIdentifier = vi.fn();
const mockGetCachedGoogleMerchantFeedData = vi.fn();
const mockGetCachedOpenAIFeedData = vi.fn();
const mockGetCachedGooglePlacesReviews = vi.fn();
const mockLoggerError = vi.fn();
const TEST_NOW = new Date('2026-05-20T12:00:00.000Z');
const PRODUCT_UPDATED_AT = '2026-05-10T00:00:00.000Z';
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

type TestMerchant = {
  business_name: string;
  business_type: string;
  custom_domain: string;
  feature_settings?: {
    google_place_id: string | null;
    google_reviews_enabled: boolean;
  };
  id: string;
  pages: {
    privacy: string;
    terms: string;
  };
  slug: string;
  support_email: string;
  trust_profile: {
    return_policy: {
      summary: string;
      window_days: number;
    };
    shipping_policy: {
      regions: string[];
      summary: string;
    };
  };
};

function merchant(): TestMerchant {
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

describe('GET /agent-trust.json', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(TEST_NOW);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'usebaci.com');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'test-places-key');

    mockGetMerchantByIdentifier.mockResolvedValue(merchant());
    mockGetCachedOpenAIFeedData.mockResolvedValue({
      products: [
        {
          id: 'product-1',
          name: 'Samsung Galaxy S25',
          description: 'Flagship phone',
          slug: 'samsung-galaxy-s25',
          price: 500_000,
          stock: 5,
          stock_quantity: 5,
          manage_stock: true,
          category: 'phones',
          average_rating: 4.7,
          review_count: 24,
          updated_at: PRODUCT_UPDATED_AT,
        },
      ],
    });
    mockGetCachedGoogleMerchantFeedData.mockResolvedValue({
      custom_domain: 'ogabassey.com',
      imageManifest: {
        'product-1': [
          {
            verified_url: 'https://cdn.example.com/product-1.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: true,
            position: 0,
          },
        ],
      },
      products: [
        {
          id: 'product-1',
          name: 'Samsung Galaxy S25',
          description: 'Flagship phone',
          slug: 'samsung-galaxy-s25',
          price: 500_000,
          stock: 5,
          stock_quantity: 5,
          manage_stock: true,
          category: 'phones',
        },
      ],
      slug: 'ogabassey',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it(
    'returns public trust readiness for storefront hosts',
    async () => {
      const { GET, maxDuration } = await import('./route');
      const response = await GET(
        new Request('https://ogabassey.com/agent-trust.json', {
          headers: { host: 'ogabassey.com' },
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(maxDuration).toBe(60);
      expect(response.headers.get('cache-control')).toBe('public, max-age=60');
      expect(response.headers.get('vercel-cdn-cache-control')).toBe(
        'public, s-maxage=1800, stale-while-revalidate=86400'
      );
      expect(body).toMatchObject({
        schema_version: '2026-05-20',
        platform: 'baci',
        store: {
          slug: 'ogabassey',
          name: 'Ogabassey',
          canonical_origin: 'https://ogabassey.com',
        },
        trust: {
          status: 'pass',
          totals: {
            openAiProducts: 1,
            googleProducts: 1,
            sharedProducts: 1,
            latestProductUpdatedAt: PRODUCT_UPDATED_AT,
            productsWithStructuredData: 1,
            staleProducts: 0,
          },
        },
      });
      expect(body.trust.surfaces.agentTrust).toBe(
        'https://ogabassey.com/agent-trust.json'
      );
      expect(body.trust.surfaces.robots).toBe(
        'https://ogabassey.com/robots.txt'
      );
      expect(body.trust.surfaces.sitemap).toBe(
        'https://ogabassey.com/sitemap.xml'
      );
      expect(body.trust.surfaces.llms).toBe('https://ogabassey.com/llms.txt');
      expect(mockGetCachedOpenAIFeedData).toHaveBeenCalledWith(
        'merchant-1',
        true
      );
      expect(mockGetCachedGoogleMerchantFeedData).toHaveBeenCalledWith(
        'merchant-1',
        'ogabassey'
      );
      expect(mockGetCachedGooglePlacesReviews).not.toHaveBeenCalled();
    },
    ROUTE_TEST_TIMEOUT_MS
  );

  it(
    'enriches configured Google review authority in the public trust payload',
    async () => {
      mockGetMerchantByIdentifier.mockResolvedValueOnce({
        ...merchant(),
        feature_settings: {
          google_place_id: 'places/ChIJ1234',
          google_reviews_enabled: true,
        },
      });
      mockGetCachedGooglePlacesReviews.mockResolvedValueOnce({
        attributionLabel: 'Google Maps',
        attributions: [
          {
            provider: 'Google Maps',
            providerUri: 'https://maps.google.com',
          },
        ],
        businessName: 'Ogabassey',
        googleMapsUrl: 'https://maps.google.com/?cid=ogabassey',
        rating: 4.8,
        reviews: [],
        reviewsSortedBy: 'relevance',
        source: 'google_maps',
        totalReviews: 217,
      });

      const { GET } = await import('./route');
      const response = await GET(
        new Request('https://ogabassey.com/agent-trust.json', {
          headers: { host: 'ogabassey.com' },
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(mockGetCachedGooglePlacesReviews).toHaveBeenCalledWith('ChIJ1234');
      expect(body.trust.merchantReviewAuthority).toMatchObject({
        attributionLabel: 'Google Maps',
        attributions: [
          {
            provider: 'Google Maps',
            providerUri: 'https://maps.google.com',
          },
        ],
        businessName: 'Ogabassey',
        googleMapsUrl: 'https://maps.google.com/?cid=ogabassey',
        placeId: 'ChIJ1234',
        rating: 4.8,
        reviewsSortedBy: 'relevance',
        source: 'google_maps',
        totalReviews: 217,
      });
      expect(
        body.trust.checks.find(
          (check: { id: string }) => check.id === 'merchant-review-authority'
        )
      ).toMatchObject({
        severity: 'pass',
      });
      expect(
        body.trust.checks.find(
          (check: { id: string }) => check.id === 'review-signal-coverage'
        )
      ).toMatchObject({
        severity: 'pass',
      });
    },
    ROUTE_TEST_TIMEOUT_MS
  );

  it(
    'keeps configured Google review authority when Places lookup fails',
    async () => {
      mockGetMerchantByIdentifier.mockResolvedValueOnce({
        ...merchant(),
        feature_settings: {
          google_place_id: 'ChIJ1234',
          google_reviews_enabled: true,
        },
      });
      mockGetCachedGooglePlacesReviews.mockRejectedValueOnce(
        new Error('Google Places API error: 403')
      );

      const { GET } = await import('./route');
      const response = await GET(
        new Request('https://ogabassey.com/agent-trust.json', {
          headers: { host: 'ogabassey.com' },
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(mockGetCachedGooglePlacesReviews).toHaveBeenCalledWith('ChIJ1234');
      expect(body.trust.merchantReviewAuthority).toMatchObject({
        attributionLabel: 'Google Maps',
        placeId: 'ChIJ1234',
        reviewsSortedBy: 'relevance',
        source: 'google_maps',
      });
      expect(
        body.trust.checks.find(
          (check: { id: string }) => check.id === 'merchant-review-authority'
        )
      ).toMatchObject({
        severity: 'warn',
      });
      expect(mockLoggerError).toHaveBeenCalledWith({
        message: 'Merchant review authority enrichment failed',
        error: expect.any(Error),
        placeId: 'ChIJ1234',
      });
    },
    ROUTE_TEST_TIMEOUT_MS
  );

  it('returns 404 when the storefront host has no merchant record', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue(null);

    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://missing.example.com/agent-trust.json', {
        headers: { host: 'missing.example.com' },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe(
      'Agent trust readiness is only available on storefront hosts'
    );
    expect(mockGetCachedOpenAIFeedData).not.toHaveBeenCalled();
    expect(mockGetCachedGoogleMerchantFeedData).not.toHaveBeenCalled();
  });

  it('returns 404 on platform hosts', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://usebaci.com/agent-trust.json', {
        headers: { host: 'usebaci.com' },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe(
      'Agent trust readiness is only available on storefront hosts'
    );
    expect(mockGetCachedOpenAIFeedData).not.toHaveBeenCalled();
    expect(mockGetCachedGoogleMerchantFeedData).not.toHaveBeenCalled();
  });

  it('returns 500 when feed data cannot be loaded', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockGetCachedOpenAIFeedData.mockRejectedValueOnce(
      new Error('feed unavailable')
    );

    try {
      const { GET } = await import('./route');
      const response = await GET(
        new Request('https://ogabassey.com/agent-trust.json', {
          headers: { host: 'ogabassey.com' },
        })
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to build agent trust readiness');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
