import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateApiRequest = vi.fn();
const mockGetUserAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockCheckCsrfProtection = vi.fn();
const mockEnrichProductPurgeEntries = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockScheduleStorefrontHostnamePurge = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateBlogPosts: vi.fn(),
  revalidateCategories: vi.fn(),
  revalidateFeatures: vi.fn(),
  revalidateMerchant: vi.fn(),
  revalidatePageConfig: vi.fn(),
  revalidateProductSlugs: vi.fn(),
  revalidateProducts: vi.fn(),
  revalidateReviews: vi.fn(),
}));
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: vi.fn(),
}));
vi.mock('@/lib/authoritative-product-purge-enrichment', () => ({
  enrichProductPurgeEntries: (...args: unknown[]) =>
    mockEnrichProductPurgeEntries(...args),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockScheduleStorefrontHostnamePurge(...args),
}));

import { POST } from './route';

const MERCHANT_ID = 'merchant-1';

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/cache/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/cache/revalidate incomplete article lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCsrfProtection.mockResolvedValue({ valid: true, response: null });
    mockHasPermission.mockReturnValue(true);
    mockGetUserAccess.mockResolvedValue({
      merchantId: MERCHANT_ID,
      role: 'owner',
    });
    mockAuthenticateApiRequest.mockResolvedValue({
      user: { id: 'user-123' },
      error: null,
      supabase: {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve({
                  data: { slug: 'ogabassey' },
                  error: null,
                })
              ),
            })),
          })),
        })),
      },
    });
  });

  it('evicts the hostname when enrichment reports an incomplete article set', async () => {
    // The zero-row article lookup failed inside enrichment; the route must
    // not trust the empty set as "no linked articles".
    mockEnrichProductPurgeEntries.mockResolvedValue({
      entries: [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
      resolvedSlugs: ['iphone-15'],
      blogPostSlugs: [],
      blogPostSlugsIncomplete: true,
    });

    const res = await POST(
      makeRequest({
        merchantId: MERCHANT_ID,
        targets: ['products'],
        products: [{ slug: 'iphone-15' }],
      })
    );

    expect(res.status).toBe(200);
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontHostnamePurge).toHaveBeenCalledWith(
      'ogabassey'
    );
  });
});
