import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetInternalApiSecret = vi.fn();
const mockRevalidateProducts = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
const mockEnrichProductPurgeEntries = vi.fn();
const mockCreatePublicClient = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockScheduleStorefrontHostnamePurge = vi.fn();
const mockResolveDependentAliases = vi.fn();

vi.mock('@/env', () => ({
  getInternalApiSecret: () => mockGetInternalApiSecret(),
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
}));
vi.mock('@/lib/authoritative-product-purge-enrichment', () => ({
  enrichProductPurgeEntries: (...args: unknown[]) =>
    mockEnrichProductPurgeEntries(...args),
}));
vi.mock('@/lib/resolve-dependent-legacy-product-identifiers', () => ({
  resolveDependentLegacyProductIdentifiers: (...args: unknown[]) =>
    mockResolveDependentAliases(...args),
}));
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: vi.fn(),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockScheduleStorefrontHostnamePurge(...args),
}));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: (...args: unknown[]) => mockCreatePublicClient(...args),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

import { POST } from './route';

const SECRET = 'test-internal-secret';
const MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    'https://app.usebaci.com/api/internal/revalidate-products',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
}

describe('POST /api/internal/revalidate-products dependent alias guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInternalApiSecret.mockReturnValue(SECRET);
    mockRevalidateProductSlugs.mockReturnValue(true);
    mockResolveDependentAliases.mockResolvedValue({
      identifiers: [],
      incomplete: false,
    });
    mockCreatePublicClient.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: { slug: 'ogabassey' }, error: null }),
          }),
        }),
      }),
    });
    mockEnrichProductPurgeEntries.mockResolvedValue({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15', 'prod-1'],
      authoritativeSlugsById: new Map([['prod-1', 'iphone-15']]),
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });
  });

  it('includes dependent legacy aliases when slugsUnchanged is true', async () => {
    mockResolveDependentAliases.mockResolvedValueOnce({
      identifiers: ['archived-child', 'child-uuid'],
      incomplete: false,
    });

    const res = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        productSlugs: ['iphone-15'],
        omitMerchantWidePdpDetails: true,
        slugsUnchanged: true,
        products: [
          { id: 'prod-1', slug: 'iphone-15', previousSlug: 'iphone-15' },
        ],
      })
    );

    expect(res.status).toBe(200);
    expect(mockRevalidateProductSlugs).toHaveBeenLastCalledWith(
      MERCHANT_ID,
      ['iphone-15', 'prod-1', 'archived-child', 'child-uuid'],
      { expireImmediately: true }
    );
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'ogabassey',
      [
        { slug: 'iphone-15', categorySegment: 'smartphones' },
        { slug: 'archived-child', categorySegment: null },
        { slug: 'child-uuid', categorySegment: null },
      ]
    );
    expect(mockRevalidateProducts).toHaveBeenLastCalledWith(
      MERCHANT_ID,
      undefined,
      { expireImmediately: true, omitMerchantWidePdpDetails: true }
    );
  });

  it('retains broad invalidation and hostname purging when slugsUnchanged is not true under anon RLS', async () => {
    const res = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        productSlugs: ['iphone-15', 'iphone-14'],
        omitMerchantWidePdpDetails: true,
        products: [
          { id: 'prod-1', slug: 'iphone-15', previousSlug: 'iphone-14' },
        ],
      })
    );

    expect(res.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenLastCalledWith(
      MERCHANT_ID,
      undefined,
      { expireImmediately: true }
    );
    expect(mockScheduleStorefrontHostnamePurge).toHaveBeenCalledWith(
      'ogabassey'
    );
  });
});
