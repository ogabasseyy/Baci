import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetInternalApiSecret = vi.fn();
const mockRevalidateProducts = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockScheduleStorefrontHostnamePurge = vi.fn();
const mockCreatePublicClient = vi.fn();
const mockMerchantLookup = vi.fn();
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
}));
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: (...args: unknown[]) =>
    mockExpireProductBlogCache(...args),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockScheduleStorefrontHostnamePurge(...args),
}));
vi.mock('@/lib/supabase/public', () => ({
  createPublicClient: (...args: unknown[]) => mockCreatePublicClient(...args),
  createClient: (...args: unknown[]) => mockCreatePublicClient(...args),
}));

import { POST } from './route';

/**
 * Minimal public-client stub matching the route's merchant lookup and the
 * enrichment's `.from(table).select(...).eq('merchant_id', …).in('id', …)`
 * chain.
 */
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
        eq: (column: string, value: string) => {
          if (table === 'merchants') {
            mockMerchantLookup(column, value);
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

function request(body: unknown, authHeader?: string): NextRequest {
  return new NextRequest(
    'https://app.usebaci.com/api/internal/revalidate-products',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }
  );
}
describe('POST /api/internal/revalidate-products', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInternalApiSecret.mockReturnValue(SECRET);
    mockCreatePublicClient.mockReturnValue(makePublicClient());
  });

  it('revalidates the merchant product caches for a valid authed request', async () => {
    const res = await POST(
      request({ merchantId: MERCHANT_ID }, `Bearer ${SECRET}`)
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockRevalidateProducts).toHaveBeenCalledWith(MERCHANT_ID);
  });
  it('busts a separately supplied complete per-slug set without an edge purge', async () => {
    const productSlugs = ['phone-1', 'phone-2', 'phone-3'];
    const res = await POST(
      request({ merchantId: MERCHANT_ID, productSlugs }, `Bearer ${SECRET}`)
    );

    expect(res.status).toBe(200);
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
      MERCHANT_ID,
      productSlugs
    );
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
  });
  it('does NOT schedule a purge for a merchantId-only body', async () => {
    await POST(request({ merchantId: MERCHANT_ID }, `Bearer ${SECRET}`));

    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
  });
  it('resolves the canonical merchant slug before scheduling a whole-storefront purge', async () => {
    const res = await POST(
      request(
        {
          merchantId: MERCHANT_ID,
          merchantSlug: 'ogabassey',
          purgeWholeStorefront: true,
        },
        `Bearer ${SECRET}`
      )
    );

    expect(res.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(MERCHANT_ID);
    expect(mockMerchantLookup).toHaveBeenCalledWith('id', MERCHANT_ID);
    expect(mockScheduleStorefrontHostnamePurge).toHaveBeenCalledWith(
      'ogabassey'
    );
    expect(mockExpireProductBlogCache).toHaveBeenCalledWith(MERCHANT_ID);
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
  });
  it('schedules a purge when merchantSlug and products are present', async () => {
    const res = await POST(
      request(
        {
          merchantId: MERCHANT_ID,
          merchantSlug: 'ogabassey',
          products: [{ slug: 'iphone-15', category: 'Smartphones' }],
        },
        `Bearer ${SECRET}`
      )
    );

    expect(res.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(MERCHANT_ID);
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'ogabassey',
      [{ slug: 'iphone-15', categorySegment: 'smartphones' }]
    );
    expect(mockExpireProductBlogCache).toHaveBeenCalledWith(MERCHANT_ID);
  });

  it('rejects a mismatched merchantSlug before scheduling a product purge', async () => {
    const res = await POST(
      request(
        {
          merchantId: MERCHANT_ID,
          merchantSlug: 'another-store',
          products: [{ slug: 'iphone-15', category: 'Smartphones' }],
        },
        `Bearer ${SECRET}`
      )
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Merchant slug does not match merchant ID',
      code: 'MERCHANT_SLUG_MISMATCH',
    });
    expect(mockMerchantLookup).toHaveBeenCalledWith('id', MERCHANT_ID);
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontHostnamePurge).not.toHaveBeenCalled();
  });

  it('resolves authoritative rows and busts per-slug Next caches BEFORE scheduling the purge (F1 + F3)', async () => {
    // {id}-only entry: the enrichment must resolve the real slug/category from
    // the authoritative row (service-role client) instead of purging /products/<uuid>.
    mockCreatePublicClient.mockReturnValue(
      makePublicClient({
        productRows: [
          {
            id: 'prod-1',
            slug: 'iphone-15',
            name: 'iPhone 15',
            category: 'Smartphones',
            categories: null,
            product_categories: [],
          },
        ],
      })
    );

    const res = await POST(
      request(
        {
          merchantId: MERCHANT_ID,
          merchantSlug: 'ogabassey',
          products: [{ id: 'prod-1' }],
        },
        `Bearer ${SECRET}`
      )
    );

    expect(res.status).toBe(200);
    // Authoritative slug + category resolved from the row (not the uuid path).
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'ogabassey',
      [{ slug: 'iphone-15', categorySegment: 'smartphones' }]
    );
    // Per-slug Next caches busted for the authoritative slug + id, BEFORE the
    // edge purge is scheduled.
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(MERCHANT_ID, [
      'iphone-15',
      'prod-1',
    ]);
    expect(mockRevalidateProductSlugs.mock.invocationCallOrder[0]).toBeLessThan(
      mockScheduleStorefrontProductPurge.mock.invocationCallOrder[0]
    );
  });

  it('busts per-slug Next caches for products sent WITHOUT merchantSlug (purge skipped)', async () => {
    const res = await POST(
      request(
        {
          merchantId: MERCHANT_ID,
          products: [{ slug: 'iphone-15', category: 'Smartphones' }],
        },
        `Bearer ${SECRET}`
      )
    );

    // The per-slug Next bust needs only merchantId — a caller whose merchant-slug
    // lookup failed must still get its PDP caches busted; only the Cloudflare
    // purge (which needs the storefront hostname) is skipped.
    expect(res.status).toBe(200);
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
      MERCHANT_ID,
      expect.arrayContaining(['iphone-15'])
    );
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
  });

  it('returns 500 when the internal secret is not configured', async () => {
    mockGetInternalApiSecret.mockReturnValue(undefined);

    const res = await POST(
      request({ merchantId: MERCHANT_ID }, `Bearer ${SECRET}`)
    );

    expect(res.status).toBe(500);
    expect(mockRevalidateProducts).not.toHaveBeenCalled();
  });

  it('returns 401 when the Authorization header is missing', async () => {
    const res = await POST(request({ merchantId: MERCHANT_ID }));

    expect(res.status).toBe(401);
    expect(mockRevalidateProducts).not.toHaveBeenCalled();
  });

  it('returns 401 when the bearer token does not match', async () => {
    const res = await POST(
      request({ merchantId: MERCHANT_ID }, 'Bearer wrong')
    );

    expect(res.status).toBe(401);
    expect(mockRevalidateProducts).not.toHaveBeenCalled();
  });

  it('returns 400 when the body is not valid JSON', async () => {
    const res = await POST(request('not-json{', `Bearer ${SECRET}`));

    expect(res.status).toBe(400);
    expect(mockRevalidateProducts).not.toHaveBeenCalled();
  });

  it('returns 400 when merchantId is missing/blank', async () => {
    const res = await POST(request({ merchantId: '   ' }, `Bearer ${SECRET}`));

    expect(res.status).toBe(400);
    expect(mockRevalidateProducts).not.toHaveBeenCalled();
  });
});
