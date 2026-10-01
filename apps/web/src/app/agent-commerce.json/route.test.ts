// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetMerchantByIdentifier = vi.fn();
const mockGetCurrentSlugForAlias = vi.fn();
const ROUTE_TEST_TIMEOUT_MS = 60_000;

vi.mock('server-only', () => ({}));

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: (...args: unknown[]) =>
    mockGetMerchantByIdentifier(...args),
}));

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: (...args: unknown[]) =>
    mockGetCurrentSlugForAlias(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', 'ogabassey');
  vi.stubEnv('OPENAI_AGENTIC_API_KEY', 'agent-api-key');
  vi.stubEnv('OPENAI_AGENTIC_CONFIRMATION_KEY', 'confirmation-key');
  vi.stubEnv('OPENAI_AGENTIC_SIGNING_KEY', 'signing-key');
  vi.stubEnv('PAYSTACK_SECRET_KEY', 'paystack-secret');
  vi.stubEnv('SUPABASE_JWT_SECRET', 'supabase-jwt-secret');

  mockGetCurrentSlugForAlias.mockResolvedValue(null);

  mockGetMerchantByIdentifier.mockResolvedValue({
    id: 'merchant-1',
    paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
    slug: 'ogabassey',
    business_name: 'Ogabassey',
    custom_domain: 'ogabassey.com',
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /agent-commerce.json', () => {
  it(
    'returns Ogabassey agent commerce capabilities for the custom domain',
    async () => {
      const { GET } = await import('./route');
      const response = await GET(
        new Request('https://ogabassey.com/agent-commerce.json', {
          headers: { host: 'ogabassey.com' },
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.schema_version).toBe('2026-04-30');
      expect(body.store).toMatchObject({
        slug: 'ogabassey',
        name: 'Ogabassey',
        canonical_origin: 'https://ogabassey.com',
      });
      expect(body.capabilities).toContain('checkout.session.complete');
      expect(body.capabilities).toContain('order.read');
      expect(body.auth?.type).toBe('bearer_hmac');
      expect(body.auth?.supported_api_versions).toEqual([
        '2026-04-30',
        '2026-04-17',
        '2026-01-01',
      ]);
      expect(body.links.product_feed).toBe(
        'https://ogabassey.com/feeds/openai.jsonl'
      );
      expect(body.links.product_api).toBe(
        'https://ogabassey.com/api/storefront/ogabassey/products'
      );
      expect(body.links.agent_native_commerce).toBe(
        'https://ogabassey.com/.well-known/agent-native-commerce'
      );
      expect(body.links.trust).toBe('https://ogabassey.com/agent-trust.json');
      expect(body.links.feeds).toMatchObject({
        agent_products: 'https://ogabassey.com/feeds/agent-products.jsonl',
        facebook_catalog_xml: 'https://ogabassey.com/feeds/facebook.xml',
        google_merchant_xml: 'https://ogabassey.com/feeds/google-merchant.xml',
      });
      expect(body.links.checkout_sessions).toBe(
        'https://ogabassey.com/api/agentic/checkout_sessions'
      );
      expect(body.links.order).toBe(
        'https://ogabassey.com/api/agentic/orders/{order_id}'
      );
      expect(body.links).toMatchObject({
        privacy_policy_url: 'https://ogabassey.com/privacy',
        return_policy_url: 'https://ogabassey.com/returns',
        shipping_policy_url: 'https://ogabassey.com/shipping',
        terms_of_service_url: 'https://ogabassey.com/terms',
      });
      expect(response.headers.get('cache-control')).toBe(
        'no-store, max-age=0, must-revalidate'
      );
      expect(response.headers.get('cdn-cache-control')).toBe('no-store');
      expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store');
      expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
      expect(JSON.stringify(body)).not.toContain('xsoljx');
    },
    ROUTE_TEST_TIMEOUT_MS
  );

  it('normalizes www custom domains before merchant lookup', async () => {
    mockGetMerchantByIdentifier.mockImplementation((identifier) => {
      if (identifier === 'ogabassey.com') {
        return Promise.resolve({
          id: 'merchant-1',
          paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
          slug: 'ogabassey',
          business_name: 'Ogabassey',
          custom_domain: 'ogabassey.com',
        });
      }

      return Promise.resolve(null);
    });

    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://www.ogabassey.com/agent-commerce.json', {
        headers: { host: 'www.ogabassey.com' },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.store).toMatchObject({
      slug: 'ogabassey',
      name: 'Ogabassey',
      canonical_origin: 'https://www.ogabassey.com',
    });
    expect(body.links.feeds.google_merchant_xml).toBe(
      'https://www.ogabassey.com/feeds/google-merchant.xml'
    );
    expect(body.links.feeds.facebook_catalog_xml).toBe(
      'https://www.ogabassey.com/feeds/facebook.xml'
    );
    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
    expect(mockGetMerchantByIdentifier).toHaveBeenCalledTimes(1);
    expect(mockGetMerchantByIdentifier).not.toHaveBeenCalledWith(
      'www.ogabassey.com'
    );
  });

  it('falls back to exact www custom-domain lookup when the normalized domain is absent', async () => {
    mockGetMerchantByIdentifier.mockImplementation((identifier) => {
      if (identifier === 'www.ogabassey.com') {
        return Promise.resolve({
          id: 'merchant-1',
          paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
          slug: 'ogabassey',
          business_name: 'Ogabassey',
          custom_domain: 'www.ogabassey.com',
        });
      }

      return Promise.resolve(null);
    });

    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://www.ogabassey.com/agent-commerce.json', {
        headers: { host: 'www.ogabassey.com' },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.store).toMatchObject({
      slug: 'ogabassey',
      name: 'Ogabassey',
      canonical_origin: 'https://www.ogabassey.com',
    });
    expect(body.links.feeds.google_merchant_xml).toBe(
      'https://www.ogabassey.com/feeds/google-merchant.xml'
    );
    expect(body.links.feeds.facebook_catalog_xml).toBe(
      'https://www.ogabassey.com/feeds/facebook.xml'
    );
    expect(mockGetMerchantByIdentifier).toHaveBeenCalledTimes(2);
    expect(mockGetMerchantByIdentifier).toHaveBeenNthCalledWith(
      1,
      'ogabassey.com'
    );
    expect(mockGetMerchantByIdentifier).toHaveBeenNthCalledWith(
      2,
      'www.ogabassey.com'
    );
    expect(mockGetCurrentSlugForAlias).toHaveBeenCalledOnce();
    expect(mockGetCurrentSlugForAlias).toHaveBeenCalledWith('ogabassey.com');
  });

  it('resolves localhost subdomains as slug identifiers', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new Request('http://ogabassey.localhost:3000/agent-commerce.json', {
        headers: { host: 'ogabassey.localhost:3000' },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.store).toMatchObject({
      slug: 'ogabassey',
      name: 'Ogabassey',
      canonical_origin: 'http://ogabassey.localhost:3000',
    });
    expect(body.links.feeds.google_merchant_xml).toBe(
      'http://ogabassey.localhost:3000/feeds/google-merchant.xml'
    );
    expect(body.links.feeds.facebook_catalog_xml).toBe(
      'http://ogabassey.localhost:3000/feeds/facebook.xml'
    );
    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey');
    expect(mockGetMerchantByIdentifier).not.toHaveBeenCalledWith(
      'ogabassey.localhost'
    );
    expect(mockGetMerchantByIdentifier).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the request host does not resolve to a storefront', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://usebaci.com/agent-commerce.json', {
        headers: { host: 'usebaci.com' },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe(
      'Agent commerce manifest is only available on storefront hosts'
    );
    expect(mockGetMerchantByIdentifier).not.toHaveBeenCalled();
  });

  it('does not trust spoofable storefront headers on the platform host', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://usebaci.com/agent-commerce.json', {
        headers: {
          host: 'usebaci.com',
          'x-custom-domain': 'ogabassey.com',
          'x-merchant-slug': 'ogabassey',
        },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe(
      'Agent commerce manifest is only available on storefront hosts'
    );
    expect(mockGetMerchantByIdentifier).not.toHaveBeenCalled();
  });

  it('treats IPv6 localhost with a port as a non-storefront host', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new Request('http://[::1]:3000/agent-commerce.json', {
        headers: { host: '[::1]:3000' },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe(
      'Agent commerce manifest is only available on storefront hosts'
    );
    expect(mockGetMerchantByIdentifier).not.toHaveBeenCalled();
  });

  it('returns 404 when the storefront host has no merchant record', async () => {
    mockGetMerchantByIdentifier.mockResolvedValue(null);

    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://missing.example.com/agent-commerce.json', {
        headers: { host: 'missing.example.com' },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe(
      'Agent commerce manifest is only available on storefront hosts'
    );
  });

  it('returns 400 when the resolved storefront identifier is invalid', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://usebaci.com/agent-commerce.json', {
        headers: { host: '<script>' },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid storefront host');
    expect(mockGetMerchantByIdentifier).not.toHaveBeenCalled();
  });

  it('returns 500 when merchant lookup fails', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockGetMerchantByIdentifier.mockRejectedValue(new Error('lookup failed'));

    try {
      const { GET } = await import('./route');
      const response = await GET(
        new Request('https://ogabassey.com/agent-commerce.json', {
          headers: { host: 'ogabassey.com' },
        })
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to build agent commerce manifest');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
