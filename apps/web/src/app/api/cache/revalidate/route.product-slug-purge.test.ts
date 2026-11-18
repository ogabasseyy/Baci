import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';

const mockAuthenticateApiRequest = vi.fn();
const mockGetUserAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockGetMerchantForApiRequest = vi.fn();
const mockToUserAccess = vi.fn();
const mockCheckCsrfProtection = vi.fn();
const mockRevalidateTag = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mockGetMerchantForApiRequest(...args),
  toUserAccess: (...args: unknown[]) => mockToUserAccess(...args),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));
vi.mock('@/lib/get-published-blog-post-slugs-for-products', () => ({
  getPublishedBlogPostSlugsForProducts: () =>
    Promise.resolve({ slugs: [], incomplete: false }),
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
}));
vi.mock('@/lib/cloudflare-purge', () => ({
  purgeCloudflareUrls: vi.fn(),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
}));
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: vi.fn(),
}));
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: vi.fn(),
}));

import { getProductScopedCacheTag } from '@/lib/product-cache-tags';
import { POST } from './route';

let merchantSlugRow: { slug: string | null } | null = { slug: 'ogabassey' };
let merchantSlugError: { message: string } | null = null;

function setupAuth() {
  mockAuthenticateApiRequest.mockResolvedValue({
    user: { id: 'user-123' },
    supabase: {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() =>
              Promise.resolve({
                data: merchantSlugError ? null : merchantSlugRow,
                error: merchantSlugError,
              })
            ),
            in: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        })),
      })),
    },
    error: null,
  });
  mockGetUserAccess.mockResolvedValue({
    merchantId: MERCHANT_ID,
    role: 'owner',
  });
  mockHasPermission.mockReturnValue(true);
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/cache/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/cache/revalidate per-slug product purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    merchantSlugRow = { slug: 'ogabassey' };
    merchantSlugError = null;
    mockCheckCsrfProtection.mockResolvedValue({ valid: true, response: null });
    setupAuth();
  });

  it('busts per-slug Next product caches BEFORE scheduling the purge (F3)', async () => {
    await POST(
      makeRequest({
        targets: ['products'],
        products: [
          { slug: 'iphone-15', id: 'prod-1', category: 'Smartphones' },
        ],
      })
    );

    const scopedTag = getProductScopedCacheTag(
      'product',
      MERCHANT_ID,
      'iphone-15'
    );
    expect(mockRevalidateTag).toHaveBeenCalledWith(scopedTag, { expire: 0 });
    const scopedCallIndex = mockRevalidateTag.mock.calls.findIndex(
      ([tag]) => tag === scopedTag
    );
    expect(
      mockRevalidateTag.mock.invocationCallOrder[scopedCallIndex]
    ).toBeLessThan(
      mockScheduleStorefrontProductPurge.mock.invocationCallOrder[0]
    );
  });

  it('does not purge when the merchant has no resolvable slug', async () => {
    merchantSlugRow = { slug: null };

    await POST(
      makeRequest({
        targets: ['products'],
        products: [{ slug: 'iphone-15', category: 'Smartphones' }],
      })
    );

    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
    expect(mockRevalidateTag).toHaveBeenCalledWith(
      getProductScopedCacheTag('product', MERCHANT_ID, 'iphone-15'),
      { expire: 0 }
    );
  });

  it('logs and skips the purge when the merchant slug lookup errors', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      merchantSlugError = { message: 'db unavailable' };

      const res = await POST(
        makeRequest({
          targets: ['products'],
          products: [
            { slug: 'iphone-15', id: 'prod-1', category: 'Smartphones' },
          ],
        })
      );

      expect(res.status).toBe(200);
      expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getProductScopedCacheTag('product', MERCHANT_ID, 'iphone-15'),
        { expire: 0 }
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve merchant slug'),
        expect.objectContaining({
          merchantId: MERCHANT_ID,
          error: { message: 'db unavailable' },
        })
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
