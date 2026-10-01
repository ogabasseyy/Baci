import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExpireProductBlogCache,
  mockScheduleStorefrontProductPurge,
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
        return {
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
});
