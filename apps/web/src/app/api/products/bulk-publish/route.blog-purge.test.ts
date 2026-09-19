import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
}));

const mockRevalidateProductSlugs = vi.fn();
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
  revalidateProducts: vi.fn(),
}));

const mockScheduleStorefrontProductPurge = vi.fn();
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
}));

const mockScheduleProductBlogPurgeAfterResponse = vi.fn();
vi.mock('@/lib/schedule-product-blog-purge-after-response', () => ({
  scheduleProductBlogPurgeAfterResponse: (...args: unknown[]) =>
    mockScheduleProductBlogPurgeAfterResponse(...args),
}));

const mockCheckCsrfProtection = vi.fn();
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

const mockHasPermission = vi.fn();
vi.mock('@/lib/api-auth', () => ({
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));

const MERCHANT_ID = 'merchant-123';
const USER_ID = 'user-123';
let updateData: unknown[] = [];
let updateError: unknown = null;

const mockGetMerchantForApiRequest = vi.fn();
const mockToUserAccess = vi.fn();
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mockGetMerchantForApiRequest(...args),
  toUserAccess: (...args: unknown[]) => mockToUserAccess(...args),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn(),
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(() =>
        Promise.resolve({
          data: { user: { id: USER_ID } },
          error: null,
        })
      ),
    },
    from: vi.fn((table: string) => {
      if (table === 'products') {
        return {
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn(() => Promise.resolve({ data: [], error: null })),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              neq: vi.fn().mockReturnValue({
                select: vi.fn(() =>
                  Promise.resolve({ data: updateData, error: updateError })
                ),
              }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
        single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      };
    }),
  })),
}));

describe('POST /api/products/bulk-publish blog purge', () => {
  const createRequest = () =>
    new Request('http://localhost/api/products/bulk-publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }) as unknown as NextRequest;

  beforeEach(() => {
    vi.clearAllMocks();
    updateData = [
      {
        id: 'product-1',
        slug: 'baci-phone',
        name: 'Baci Phone',
        category: 'Phones',
      },
    ];
    updateError = null;
    mockCheckCsrfProtection.mockResolvedValue({ valid: true, response: null });
    mockHasPermission.mockReturnValue(true);
    mockGetMerchantForApiRequest.mockResolvedValue({
      merchantId: MERCHANT_ID,
      merchantSlug: 'test-store',
      staffAccess: {
        isStaff: false,
        isOwner: true,
        role: null,
        permissions: { full_access: { all: true } },
      },
    });
    mockToUserAccess.mockReturnValue({
      merchantId: MERCHANT_ID,
      isStaff: false,
      isOwner: true,
      role: 'owner',
      permissions: { full_access: { all: true } },
    });
  });

  it('revalidates per-slug tags and schedules linked blog purges', async () => {
    const { POST } = await import('./route');

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(MERCHANT_ID, [
      'baci-phone',
    ]);
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      [{ slug: 'baci-phone', categorySegment: 'phones' }]
    );
    expect(mockScheduleProductBlogPurgeAfterResponse).toHaveBeenCalledWith({
      supabase: expect.anything(),
      merchantId: MERCHANT_ID,
      merchantSlug: 'test-store',
      productIds: ['product-1'],
      entries: [{ slug: 'baci-phone', categorySegment: 'phones' }],
      categorySlugs: ['phones'],
      skipProductPurge: true,
    });
    expect(mockRevalidateProductSlugs.mock.invocationCallOrder[0]).toBeLessThan(
      mockScheduleStorefrontProductPurge.mock.invocationCallOrder[0]
    );
  });
});
