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

describe('POST /api/internal/revalidate-products scoped fallback guards', () => {
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
  });

  it('falls back to full merchant-wide PDP invalidation when revalidateProductSlugs returns false', async () => {
    mockRevalidateProductSlugs.mockReturnValueOnce(false);

    const chunkRes = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        productSlugs: ['iphone-15'],
        omitMerchantWidePdpDetails: true,
      })
    );
    expect(chunkRes.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      MERCHANT_ID,
      undefined,
      { expireImmediately: true }
    );

    mockRevalidateProducts.mockClear();
    mockRevalidateProductSlugs
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    mockEnrichProductPurgeEntries.mockResolvedValueOnce({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15', 'prod-1'],
      authoritativeSlugsById: new Map([['prod-1', 'iphone-15']]),
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });

    const productsRes = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        productSlugs: ['iphone-15'],
        omitMerchantWidePdpDetails: true,
        products: [{ id: 'prod-1' }],
      })
    );
    expect(productsRes.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      MERCHANT_ID,
      undefined,
      { expireImmediately: true }
    );
  });

  it('rejects a stale merchantSlug mismatch with 400 without scheduling edge purges while preserving origin invalidation', async () => {
    const res = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        merchantSlug: 'another-store',
        productSlugs: ['iphone-15'],
        omitMerchantWidePdpDetails: true,
        products: [{ slug: 'iphone-15', category: 'Smartphones' }],
      })
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Merchant slug does not match merchant ID',
      code: 'MERCHANT_SLUG_MISMATCH',
    });
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
      MERCHANT_ID,
      ['iphone-15'],
      { expireImmediately: true }
    );
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      MERCHANT_ID,
      undefined,
      { expireImmediately: true }
    );
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontHostnamePurge).not.toHaveBeenCalled();
  });

  it('falls back to full merchant-wide PDP invalidation for slug-only products without ids', async () => {
    mockEnrichProductPurgeEntries.mockResolvedValueOnce({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15'],
      authoritativeSlugsById: new Map(),
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });

    const res = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        productSlugs: ['iphone-15'],
        omitMerchantWidePdpDetails: true,
        products: [{ slug: 'iphone-15', category: 'Smartphones' }],
      })
    );

    expect(res.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledTimes(1);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      MERCHANT_ID,
      undefined,
      { expireImmediately: true }
    );
  });

  it('hard-expires broad product caches in the catch block when enrichment throws in blog-cache mode with omitMerchantWidePdpDetails', async () => {
    mockEnrichProductPurgeEntries.mockRejectedValueOnce(new Error('db failed'));

    const res = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        expireProductBlogCache: true,
        productSlugs: ['iphone-15'],
        omitMerchantWidePdpDetails: true,
        products: [{ id: 'prod-1' }],
      })
    );

    expect(res.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      MERCHANT_ID,
      undefined,
      { expireImmediately: true }
    );
  });

  it('expires merchant-wide caches (and returns 500 if that fails) when explicit slug expiry fails in blog mode without authoritativeMerchantSlug', async () => {
    mockRevalidateProductSlugs.mockReturnValueOnce(false);
    mockEnrichProductPurgeEntries.mockResolvedValue({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15'],
      authoritativeSlugsById: new Map([['prod-1', 'iphone-15']]),
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });

    const body = {
      merchantId: MERCHANT_ID,
      expireProductBlogCache: true,
      productSlugs: ['iphone-15'],
      omitMerchantWidePdpDetails: true,
      products: [{ id: 'prod-1' }],
    };
    const okRes = await POST(makeRequest(body));
    expect(okRes.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      MERCHANT_ID,
      undefined,
      {
        expireImmediately: true,
      }
    );

    mockRevalidateProductSlugs.mockReturnValueOnce(false);
    mockRevalidateProducts.mockReturnValueOnce(false);
    const failRes = await POST(makeRequest(body));
    expect(failRes.status).toBe(500);
  });

  it('returns 500 when the catch fallback fails to expire merchant-wide caches', async () => {
    mockEnrichProductPurgeEntries.mockRejectedValueOnce(new Error('db failed'));
    mockRevalidateProducts.mockReturnValueOnce(false);

    const res = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        expireProductBlogCache: true,
        productSlugs: ['iphone-15'],
        omitMerchantWidePdpDetails: true,
        products: [{ id: 'prod-1' }],
      })
    );
    expect(res.status).toBe(500);
  });

  it('escalates incomplete dependent legacy alias lookups to broad and hostname purge', async () => {
    mockEnrichProductPurgeEntries.mockResolvedValueOnce({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15', 'prod-1'],
      authoritativeSlugsById: new Map([['prod-1', 'iphone-15']]),
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });
    mockResolveDependentAliases.mockResolvedValueOnce({
      identifiers: ['archived-child'],
      incomplete: true,
    });

    const res = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        productSlugs: ['iphone-15'],
        omitMerchantWidePdpDetails: true,
        products: [
          { id: 'prod-1', slug: 'iphone-15', previousSlug: 'iphone-15' },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      MERCHANT_ID,
      undefined,
      {
        expireImmediately: true,
      }
    );
    expect(mockScheduleStorefrontHostnamePurge).toHaveBeenCalledWith(
      'ogabassey'
    );
  });
});
