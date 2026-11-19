import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExpireProductBlogCache,
  mockScheduleStorefrontProductPurge,
  mockScheduleStorefrontHostnamePurge,
  mockScheduleProductBlogPurgeAfterResponse,
  mockRevalidateProducts,
  mockRevalidateProductSlugs,
  mockCheckCsrfProtection,
  mockHasPermission,
  mockGetMerchantForApiRequest,
  mockToUserAccess,
  mockCreateClient,
} = vi.hoisted(() => ({
  mockExpireProductBlogCache: vi.fn(),
  mockScheduleStorefrontProductPurge: vi.fn(),
  mockScheduleStorefrontHostnamePurge: vi.fn(),
  mockScheduleProductBlogPurgeAfterResponse: vi.fn(),
  mockRevalidateProducts: vi.fn(),
  mockRevalidateProductSlugs: vi.fn(),
  mockCheckCsrfProtection: vi.fn(),
  mockHasPermission: vi.fn(),
  mockGetMerchantForApiRequest: vi.fn(),
  mockToUserAccess: vi.fn(),
  mockCreateClient: vi.fn(),
}));

vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: mockExpireProductBlogCache,
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: mockScheduleStorefrontProductPurge,
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: mockScheduleStorefrontHostnamePurge,
}));
vi.mock('@/lib/schedule-product-blog-purge-after-response', () => ({
  scheduleProductBlogPurgeAfterResponse:
    mockScheduleProductBlogPurgeAfterResponse,
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: mockRevalidateProducts,
  revalidateProductSlugs: mockRevalidateProductSlugs,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mockCheckCsrfProtection,
}));
vi.mock('@/lib/api-auth', () => ({ hasPermission: mockHasPermission }));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mockGetMerchantForApiRequest,
  toUserAccess: mockToUserAccess,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mockCreateClient }));
vi.mock('@/lib/storefront-product-purge-urls', () => ({
  resolveProductPurgeCategorySegmentForRow: () => 'smartphones',
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({}),
}));

const updatedProducts = Array.from({ length: 51 }, (_, index) => ({
  id: `product-${index}`,
  name: `Phone ${index}`,
  slug: `phone-${index}`,
}));

function makeQuery(data: unknown[], error: unknown = null) {
  const query = {
    eq: vi.fn(),
    neq: vi.fn(),
    select: vi.fn(),
  };
  query.eq.mockReturnValue(query);
  query.neq.mockReturnValue(query);
  query.select.mockResolvedValue({ data, error });
  return query;
}

describe('POST /api/products/bulk-publish purge ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRevalidateProducts.mockReturnValue(true);
    mockRevalidateProductSlugs.mockReturnValue(true);
    mockCheckCsrfProtection.mockResolvedValue({ valid: true, response: null });
    mockHasPermission.mockReturnValue(true);
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-1',
      merchantSlug: 'test-store',
    });
    mockToUserAccess.mockReturnValue({ role: 'owner' });
    const deleteQuery = makeQuery([]);
    const updateQuery = makeQuery(updatedProducts);
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
      from: vi.fn((table: string) => {
        if (table !== 'products') throw new Error(`unexpected table: ${table}`);
        const aliasQuery = {
          eq: vi.fn(() => aliasQuery),
          in: vi.fn(() => aliasQuery),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
        return {
          select: vi.fn(() => aliasQuery),
          delete: vi.fn().mockReturnValue(deleteQuery),
          update: vi.fn().mockReturnValue(updateQuery),
        };
      }),
    });
  });

  it('expires related-blog data before the hostname purge threshold is scheduled', async () => {
    const { POST } = await import('./route');

    const response = await POST(
      new Request('http://localhost/api/products/bulk-publish', {
        method: 'POST',
      }) as never
    );

    expect(response.status).toBe(200);
    expect(mockRevalidateProducts).not.toHaveBeenCalledWith('merchant-1');
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { expireImmediately: true, omitMerchantWidePdpDetails: true }
    );
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
      'merchant-1',
      expect.arrayContaining([
        ...updatedProducts.map((product) => product.slug),
        ...updatedProducts.map((product) => product.id),
      ]),
      { expireImmediately: true }
    );
    expect(mockExpireProductBlogCache).toHaveBeenCalledWith('merchant-1');
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      expect.arrayContaining([
        { slug: 'phone-0', categorySegment: 'smartphones' },
      ])
    );
    expect(mockExpireProductBlogCache.mock.invocationCallOrder[0]).toBeLessThan(
      mockScheduleStorefrontProductPurge.mock.invocationCallOrder[0]
    );
  });

  it('falls back to broad hard expiry when per-slug expiry fails on bulk publish', async () => {
    mockRevalidateProductSlugs.mockReturnValueOnce(false);
    const { POST } = await import('./route');

    const response = await POST(
      new NextRequest('http://localhost/api/products/bulk-publish', {
        method: 'POST',
      })
    );

    expect(response.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { expireImmediately: true }
    );
  });

  it('skips edge purge when both per-slug and broad hard expiry fail on bulk publish', async () => {
    mockRevalidateProductSlugs.mockReturnValueOnce(false);
    mockRevalidateProducts.mockReturnValueOnce(false);
    const { POST } = await import('./route');

    const response = await POST(
      new NextRequest('http://localhost/api/products/bulk-publish', {
        method: 'POST',
      })
    );

    expect(response.status).toBe(200);
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
    expect(mockScheduleProductBlogPurgeAfterResponse).not.toHaveBeenCalled();
  });

  it('expires dependent legacy child aliases before scoped bulk-publish expiry', async () => {
    const deleteQuery = makeQuery([]);
    const updateQuery = makeQuery([updatedProducts[0]]);
    const aliasQuery = {
      eq: vi.fn(() => aliasQuery),
      in: vi.fn(() => aliasQuery),
      limit: vi.fn().mockResolvedValue({
        data: [{ id: 'child-1', slug: 'old-child' }],
        error: null,
      }),
    };
    mockCreateClient.mockReturnValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: 'user-1' } } }),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => aliasQuery),
        delete: vi.fn().mockReturnValue(deleteQuery),
        update: vi.fn().mockReturnValue(updateQuery),
      })),
    });
    const { POST } = await import('./route');

    const response = await POST(
      new NextRequest('http://localhost/api/products/bulk-publish', {
        method: 'POST',
      })
    );

    expect(response.status).toBe(200);
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
      'merchant-1',
      ['phone-0', 'product-0', 'child-1', 'old-child'],
      { expireImmediately: true }
    );
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      [
        { slug: 'phone-0', categorySegment: 'smartphones' },
        { slug: 'product-0', categorySegment: null },
        { slug: 'child-1', categorySegment: null },
        { slug: 'old-child', categorySegment: null },
      ]
    );

    aliasQuery.limit.mockResolvedValueOnce({
      data: null,
      error: { message: 'db timeout' },
    });
    const incompleteRes = await POST(
      new NextRequest('http://localhost/api/products/bulk-publish', {
        method: 'POST',
      })
    );
    expect(incompleteRes.status).toBe(200);
    expect(mockScheduleStorefrontHostnamePurge).toHaveBeenCalledWith(
      'test-store'
    );

    mockScheduleStorefrontHostnamePurge.mockClear();
    aliasQuery.limit.mockResolvedValueOnce({
      data: null,
      error: { message: 'db timeout' },
    });
    mockExpireProductBlogCache.mockReturnValueOnce(false);
    const failedBlogRes = await POST(
      new NextRequest('http://localhost/api/products/bulk-publish', {
        method: 'POST',
      })
    );
    expect(failedBlogRes.status).toBe(200);
    expect(mockScheduleStorefrontHostnamePurge).not.toHaveBeenCalled();
  });

  it('retains broad PDP expiry when a published product has a blank slug', async () => {
    const deleteQuery = makeQuery([]);
    const updateQuery = makeQuery([
      { id: 'product-blank', name: 'No Slug', slug: null },
    ]);
    const aliasQuery = {
      eq: vi.fn(() => aliasQuery),
      in: vi.fn(() => aliasQuery),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const getUser = vi
      .fn()
      .mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockCreateClient.mockReturnValue({
      auth: { getUser },
      from: vi.fn(() => ({
        select: vi.fn(() => aliasQuery),
        delete: vi.fn().mockReturnValue(deleteQuery),
        update: vi.fn().mockReturnValue(updateQuery),
      })),
    });
    const { POST } = await import('./route');

    const response = await POST(
      new NextRequest('http://localhost/api/products/bulk-publish', {
        method: 'POST',
      })
    );
    expect(response.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { expireImmediately: true }
    );
  });
});
