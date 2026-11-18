import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetInternalApiSecret = vi.fn();
const mockRevalidateProducts = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
const mockEnrichProductPurgeEntries = vi.fn();
const mockCreatePublicClient = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockScheduleStorefrontHostnamePurge = vi.fn();

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

describe('POST /api/internal/revalidate-products scoped PDP invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInternalApiSecret.mockReturnValue(SECRET);
    mockRevalidateProductSlugs.mockReturnValue(true);
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

  it('omits merchant-wide PDP details when explicit productSlugs and complete products resolve', async () => {
    mockEnrichProductPurgeEntries.mockResolvedValueOnce({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15', 'prod-1'],
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });

    const res = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        productSlugs: ['iphone-15'],
        products: [{ id: 'prod-1' }],
      })
    );

    expect(res.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledTimes(1);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      MERCHANT_ID,
      undefined,
      { expireImmediately: true, omitMerchantWidePdpDetails: true }
    );
  });

  it('keeps full merchant-wide PDP invalidation when products omit explicit productSlugs', async () => {
    mockEnrichProductPurgeEntries.mockResolvedValueOnce({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15', 'prod-1'],
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });

    const res = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        products: [{ id: 'prod-1' }],
      })
    );

    expect(res.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledTimes(1);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(MERCHANT_ID);
  });

  it('keeps full merchant-wide PDP invalidation when an id-only product fails authoritative slug lookup', async () => {
    mockEnrichProductPurgeEntries.mockResolvedValueOnce({
      entries: [{ slug: 'prod-archived', categorySegment: null }],
      resolvedSlugs: ['prod-archived'],
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });

    const res = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        productSlugs: ['iphone-15'],
        products: [{ id: 'prod-archived' }],
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

  it('keeps full merchant-wide PDP invalidation when blogPostSlugsIncomplete is true', async () => {
    mockEnrichProductPurgeEntries.mockResolvedValueOnce({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15'],
      blogPostSlugs: [],
      blogPostSlugsIncomplete: true,
    });

    const res = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        productSlugs: ['iphone-15'],
        products: [{ slug: 'iphone-15' }],
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

  it('keeps full merchant-wide PDP invalidation when no product slugs resolve', async () => {
    mockEnrichProductPurgeEntries.mockResolvedValueOnce({
      entries: [],
      resolvedSlugs: [],
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });

    const res = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        productSlugs: ['iphone-15'],
        products: [{ id: 'prod-1' }],
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

  it('falls back to full merchant-wide PDP invalidation when enrichment throws', async () => {
    mockEnrichProductPurgeEntries.mockRejectedValueOnce(new Error('db failed'));

    const res = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        productSlugs: ['iphone-15'],
        products: [{ id: 'prod-1' }],
      })
    );

    expect(res.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledTimes(1);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(MERCHANT_ID);
  });

  it('falls back to full merchant-wide PDP invalidation when revalidateProductSlugs returns false on slug-chunk or product paths', async () => {
    mockRevalidateProductSlugs.mockReturnValueOnce(false);

    const chunkRes = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        productSlugs: ['iphone-15'],
      })
    );
    expect(chunkRes.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(MERCHANT_ID);

    mockRevalidateProducts.mockClear();
    mockRevalidateProductSlugs
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    mockEnrichProductPurgeEntries.mockResolvedValueOnce({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15', 'prod-1'],
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });

    const productsRes = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        productSlugs: ['iphone-15'],
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

  it('rejects a stale merchantSlug mismatch before mutating caches or scheduling purges', async () => {
    const res = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        merchantSlug: 'another-store',
        productSlugs: ['iphone-15'],
        products: [{ slug: 'iphone-15', category: 'Smartphones' }],
      })
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Merchant slug does not match merchant ID',
      code: 'MERCHANT_SLUG_MISMATCH',
    });
    expect(mockRevalidateProductSlugs).not.toHaveBeenCalled();
    expect(mockRevalidateProducts).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontHostnamePurge).not.toHaveBeenCalled();
  });
});
