import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCheckCsrf = vi.fn();
const mockAuth = vi.fn();
const mockAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockMerchant = vi.fn();
const mockEnrich = vi.fn();
const mockRevalidateProducts = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
const mockExpireBlog = vi.fn();
const mockPurgeProduct = vi.fn();
const mockPurgeHostname = vi.fn();

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrf(...args),
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => mockAuth(...args),
  getUserAccess: (...args: unknown[]) => mockAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) => mockMerchant(...args),
  toUserAccess: vi.fn(() => ({
    isOwner: true,
    isStaff: false,
    permissions: {},
    role: 'owner',
  })),
}));
vi.mock('@/lib/authoritative-product-purge-enrichment', () => ({
  enrichProductPurgeEntries: (...args: unknown[]) => mockEnrich(...args),
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateBlogPosts: vi.fn(),
  revalidateCategories: vi.fn(),
  revalidateFeatures: vi.fn(),
  revalidateMerchant: vi.fn(),
  revalidatePageConfig: vi.fn(),
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
  revalidateReviews: vi.fn(),
}));
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: (...args: unknown[]) => mockExpireBlog(...args),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockPurgeProduct(...args),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockPurgeHostname(...args),
}));

import { POST } from './route';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/cache/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/cache/revalidate scoped PDP hard-expiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCsrf.mockResolvedValue({ valid: true, response: null });
    mockRevalidateProducts.mockReturnValue(true);
    mockRevalidateProductSlugs.mockReturnValue(true);
    mockAccess.mockResolvedValue({
      merchantId: MERCHANT_ID,
      isOwner: true,
      permissions: {},
    });
    mockHasPermission.mockReturnValue(true);
    mockMerchant.mockResolvedValue({ merchantId: MERCHANT_ID });
    mockAuth.mockResolvedValue({
      user: { id: 'user-1' },
      supabase: {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { slug: 'ogabassey' },
                error: null,
              }),
            })),
          })),
        })),
      },
      error: null,
    });
  });

  it('hard-expires merchant-wide PDP details when blogPostSlugsIncomplete is true', async () => {
    mockEnrich.mockResolvedValue({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15'],
      authoritativeSlugsById: new Map([['prod-1', 'iphone-15']]),
      blogPostSlugs: ['known-guide'],
      blogPostSlugsIncomplete: true,
    });

    const response = await POST(
      makeRequest({
        targets: ['products'],
        products: [{ id: 'prod-1', slug: 'iphone-15' }],
      })
    );

    expect(response.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      MERCHANT_ID,
      undefined,
      { expireImmediately: true }
    );
    expect(mockPurgeHostname).toHaveBeenCalledWith('ogabassey');
  });

  it('hard-expires merchant-wide PDP details when an ID-only product fails slug resolution', async () => {
    mockEnrich.mockResolvedValue({
      entries: [{ slug: 'prod-1', categorySegment: null }],
      resolvedSlugs: ['prod-1'],
      authoritativeSlugsById: new Map<string, string>(),
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });

    const response = await POST(
      makeRequest({
        targets: ['products'],
        products: [{ id: 'prod-1' }],
      })
    );

    expect(response.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      MERCHANT_ID,
      undefined,
      { expireImmediately: true }
    );
  });

  it('hard-expires scoped listing tags while omitting merchant-wide PDP details when scoped product and blog slugs are complete', async () => {
    mockEnrich.mockResolvedValue({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15'],
      authoritativeSlugsById: new Map([['prod-1', 'iphone-15']]),
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });

    const response = await POST(
      makeRequest({
        targets: ['products'],
        products: [{ id: 'prod-1' }],
      })
    );

    expect(response.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledTimes(1);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      MERCHANT_ID,
      undefined,
      { expireImmediately: true, omitMerchantWidePdpDetails: true }
    );
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
      MERCHANT_ID,
      ['iphone-15'],
      { expireImmediately: true }
    );
    expect(mockPurgeProduct).toHaveBeenCalledWith('ogabassey', [
      { slug: 'iphone-15', categorySegment: 'smartphones' },
    ]);
  });

  it('skips Cloudflare edge purge and reports failed target when origin hard expiry fails', async () => {
    mockRevalidateProducts.mockReturnValue(false);
    mockEnrich.mockResolvedValue({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15'],
      authoritativeSlugsById: new Map([['prod-1', 'iphone-15']]),
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });

    const response = await POST(
      makeRequest({
        targets: ['products'],
        products: [{ id: 'prod-1' }],
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      failedTargets: ['products'],
      revalidated: [],
    });
    expect(mockPurgeProduct).not.toHaveBeenCalled();
    expect(mockPurgeHostname).not.toHaveBeenCalled();
  });

  it('hard-expires merchant-wide PDP details when scoped slug revalidation returns false', async () => {
    mockRevalidateProductSlugs.mockReturnValueOnce(false);
    mockEnrich.mockResolvedValue({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15'],
      authoritativeSlugsById: new Map([['prod-1', 'iphone-15']]),
      blogPostSlugs: [],
      blogPostSlugsIncomplete: false,
    });

    const response = await POST(
      makeRequest({
        targets: ['products'],
        products: [{ id: 'prod-1' }],
      })
    );

    expect(response.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      MERCHANT_ID,
      undefined,
      { expireImmediately: true }
    );
  });

  it('hard-expires broad product caches in the catch block when enrichment throws', async () => {
    mockEnrich.mockRejectedValueOnce(new Error('lookup failed'));
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      const response = await POST(
        makeRequest({
          targets: ['products'],
          products: [{ id: 'prod-1' }],
        })
      );

      expect(response.status).toBe(200);
      expect(mockRevalidateProducts).toHaveBeenCalledWith(
        MERCHANT_ID,
        undefined,
        { expireImmediately: true }
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
