import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetInternalApiSecret = vi.fn();
const mockRevalidateProducts = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockPurgeStorefrontProductConfirmed = vi.fn();
const mockScheduleStorefrontHostnamePurge = vi.fn();
const mockPurgeStorefrontHostnameConfirmed = vi.fn();
const mockCreatePublicClient = vi.fn();
const mockExpireProductBlogCache = vi.fn();

vi.mock('@/env', () => ({
  getInternalApiSecret: () => mockGetInternalApiSecret(),
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
  purgeStorefrontProductConfirmed: (...args: unknown[]) =>
    mockPurgeStorefrontProductConfirmed(...args),
}));
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: (...args: unknown[]) =>
    mockExpireProductBlogCache(...args),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockScheduleStorefrontHostnamePurge(...args),
  purgeStorefrontHostnameConfirmed: (...args: unknown[]) =>
    mockPurgeStorefrontHostnameConfirmed(...args),
}));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: (...args: unknown[]) => mockCreatePublicClient(...args),
  createClient: (...args: unknown[]) => mockCreatePublicClient(...args),
}));
vi.mock('@/lib/get-published-blog-post-slugs-for-products', () => ({
  getPublishedBlogPostSlugsForProducts: () =>
    Promise.resolve({ slugs: [], incomplete: false }),
}));

import { POST } from './route';

function makePublicClient({
  merchantSlug = 'ogabassey',
  productRows = [],
}: {
  merchantSlug?: string | null;
  productRows?: Record<string, unknown>[];
} = {}) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => {
          if (table === 'merchants') {
            return {
              maybeSingle: () =>
                Promise.resolve({
                  data: merchantSlug === null ? null : { slug: merchantSlug },
                  error: null,
                }),
            };
          }
          return {
            in: () =>
              Promise.resolve({
                data: table === 'products' ? productRows : [],
                error: null,
              }),
          };
        },
      }),
    }),
  };
}

const SECRET = 'test-internal-secret';
const MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

function request(body: unknown): NextRequest {
  return new NextRequest(
    'https://app.usebaci.com/api/internal/revalidate-products',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SECRET}`,
      },
      body: JSON.stringify(body),
    }
  );
}

describe('POST /api/internal/revalidate-products confirmed edge purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInternalApiSecret.mockReturnValue(SECRET);
    mockExpireProductBlogCache.mockReturnValue(true);
  });

  it('awaits confirmed product purge with forwarded blogPostSlugs when confirmEdgeEviction is true', async () => {
    mockCreatePublicClient.mockReturnValue(
      makePublicClient({
        merchantSlug: 'ogabassey',
        productRows: [
          {
            id: 'prod-1',
            slug: 'iphone-15',
            category: 'smartphones',
            categories: null,
            product_categories: [],
          },
        ],
      })
    );
    mockPurgeStorefrontProductConfirmed.mockResolvedValueOnce(true);

    const res = await POST(
      request({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        expireProductBlogCache: true,
        confirmEdgeEviction: true,
        blogPostSlugs: ['iphone-guide'],
        products: [{ slug: 'iphone-15', categorySlug: 'smartphones' }],
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, edgePurged: true });
    expect(mockPurgeStorefrontProductConfirmed).toHaveBeenCalledWith(
      'ogabassey',
      [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      { blogPostSlugs: ['iphone-guide'] }
    );
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
  });

  it('returns edgePurged: false when confirmed hostname purge fails', async () => {
    mockCreatePublicClient.mockReturnValue(
      makePublicClient({ merchantSlug: 'ogabassey' })
    );
    mockPurgeStorefrontHostnameConfirmed.mockResolvedValueOnce(false);

    const res = await POST(
      request({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        expireProductBlogCache: true,
        confirmEdgeEviction: true,
        purgeWholeStorefront: true,
      })
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, edgePurged: false });
    expect(mockPurgeStorefrontHostnameConfirmed).toHaveBeenCalledWith(
      'ogabassey'
    );
  });

  it('withholds edge product purge and returns 500 when origin hard expiry fails', async () => {
    mockCreatePublicClient.mockReturnValue(
      makePublicClient({
        merchantSlug: 'ogabassey',
        productRows: [
          {
            id: 'prod-1',
            slug: 'iphone-15',
            category: 'smartphones',
            categories: null,
            product_categories: [],
          },
        ],
      })
    );
    mockRevalidateProductSlugs.mockReturnValue(true);
    mockRevalidateProducts.mockReturnValue(false);

    const res = await POST(
      request({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        confirmEdgeEviction: true,
        omitMerchantWidePdpDetails: true,
        productSlugs: ['iphone-15'],
        products: [{ id: 'prod-1', slug: 'iphone-15' }],
      })
    );

    expect(res.status).toBe(500);
    expect(mockRevalidateProducts).toHaveBeenNthCalledWith(
      1,
      MERCHANT_ID,
      undefined,
      { expireImmediately: true, omitMerchantWidePdpDetails: true }
    );
    expect(mockRevalidateProducts).toHaveBeenNthCalledWith(
      2,
      MERCHANT_ID,
      undefined,
      { expireImmediately: true }
    );
    expect(mockPurgeStorefrontProductConfirmed).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
  });

  it('withholds edge hostname purge and returns 500 when origin hard expiry fails', async () => {
    mockCreatePublicClient.mockReturnValue(
      makePublicClient({ merchantSlug: 'ogabassey' })
    );
    mockExpireProductBlogCache.mockReturnValueOnce(false);

    const res = await POST(
      request({
        merchantId: MERCHANT_ID,
        merchantSlug: 'ogabassey',
        confirmEdgeEviction: true,
        purgeWholeStorefront: true,
      })
    );

    expect(res.status).toBe(500);
    expect(mockPurgeStorefrontHostnameConfirmed).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontHostnamePurge).not.toHaveBeenCalled();
  });
});
