import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks ----

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
}));

// Mock api-auth
const mockAuthenticateApiRequest = vi.fn();
const mockGetUserAccess = vi.fn();
const mockHasPermission = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));

// Mock the merchant re-resolution used to VERIFY a client-supplied merchantId.
const mockGetMerchantForApiRequest = vi.fn();
const mockToUserAccess = vi.fn();

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mockGetMerchantForApiRequest(...args),
  toUserAccess: (...args: unknown[]) => mockToUserAccess(...args),
}));

// Mock CSRF
const mockCheckCsrfProtection = vi.fn();
const mockGetMerchantBlogCacheIdentifiers = vi.fn();
const mockGetMerchantBlogPostCategories = vi.fn();
const mockGetMerchantBlogPostSlugs = vi.fn();

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/get-merchant-blog-cache-identifiers', () => ({
  getMerchantBlogRevalidationContext: (...args: unknown[]) =>
    mockGetMerchantBlogCacheIdentifiers(...args),
}));

vi.mock('@/lib/get-merchant-blog-post-categories', () => ({
  getMerchantBlogPostCategories: (...args: unknown[]) =>
    mockGetMerchantBlogPostCategories(...args),
}));

vi.mock('@/lib/get-merchant-blog-post-slugs', () => ({
  getMerchantBlogPostSlugs: (...args: unknown[]) =>
    mockGetMerchantBlogPostSlugs(...args),
}));

// Mock next/cache
const mockRevalidatePath = vi.fn();
const mockRevalidateTag = vi.fn();

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
  revalidateTag: (...args: unknown[]) => mockRevalidateTag(...args),
}));

// Mock Cloudflare edge purge (fire-and-forget dependency of revalidateBlogPosts)
const mockPurgeCloudflareUrls = vi.fn();

vi.mock('@/lib/cloudflare-purge', () => ({
  purgeCloudflareUrls: (...args: unknown[]) => mockPurgeCloudflareUrls(...args),
}));

// Mock the product Cloudflare purge scheduler so the mobile-admin-driven
// product purge can be asserted directly.
const mockScheduleStorefrontProductPurge = vi.fn();
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
}));
const mockExpireProductBlogCache = vi.fn();
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: (...args: unknown[]) =>
    mockExpireProductBlogCache(...args),
}));

// ---- Import handler AFTER mocks ----
import { getBlogCacheTag } from '@/lib/blog-cache-tags';
import { getBlogContentLinksCacheTag } from '@/lib/blog-content-link-cache-tags';
import { getCategoryPageDataCacheTag } from '@/lib/category-page-cache-tags';
import { getProductScopedCacheTag } from '@/lib/product-cache-tags';
import { POST } from './route';

// ---- Helpers ----

const MERCHANT_ID = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
// A DIFFERENT merchant the caller also belongs to (multi-merchant staff/owner).
const OTHER_MERCHANT_ID = 'b0f4a2c1-1111-4c2b-9aaa-222233334444';

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/cache/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Merchant row returned by the slug lookup the product-purge path performs.
let merchantSlugRow: { slug: string | null } | null = { slug: 'ogabassey' };
// Optional error the merchant slug lookup surfaces (fail-open coverage).
let merchantSlugError: { message: string } | null = null;
// Product rows returned by the authoritative category lookup (id → row).
let productCategoryRows: Record<string, unknown>[] = [];
// Optional error the authoritative product-row lookup surfaces (fail-open).
let productRowsError: { message: string } | null = null;
// Category rows returned by the previous-category slug lookup (id → { slug }).
let categoryRows: Record<string, unknown>[] = [];
// Optional error the previous-category slug lookup surfaces (fail-open).
let categoryRowsError: { message: string } | null = null;

function makeSupabaseMock() {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({
              data: merchantSlugError ? null : merchantSlugRow,
              error: merchantSlugError,
            })
          ),
          in: vi.fn(() => {
            if (table === 'categories') {
              return Promise.resolve({
                data: categoryRowsError ? null : categoryRows,
                error: categoryRowsError,
              });
            }
            return Promise.resolve({
              data: productRowsError
                ? null
                : table === 'products'
                  ? productCategoryRows
                  : [],
              error: productRowsError,
            });
          }),
        })),
      })),
    })),
  };
}

function setupAuth(hasAccess = true, hasPermissionValue = true) {
  mockAuthenticateApiRequest.mockResolvedValue({
    user: hasAccess ? { id: 'user-123' } : null,
    supabase: hasAccess ? makeSupabaseMock() : null,
    error: hasAccess ? null : 'Unauthorized',
  });

  mockGetUserAccess.mockResolvedValue(
    hasAccess
      ? {
          merchantId: MERCHANT_ID,
          role: 'owner',
        }
      : null
  );

  mockHasPermission.mockReturnValue(hasPermissionValue);
}

function setupCsrf(valid = true) {
  mockCheckCsrfProtection.mockResolvedValue({
    valid,
    response: valid ? null : { status: 403 },
  });
}

// ---- Tests ----

describe('POST /api/cache/revalidate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    merchantSlugRow = { slug: 'ogabassey' };
    merchantSlugError = null;
    productCategoryRows = [];
    productRowsError = null;
    categoryRows = [];
    categoryRowsError = null;
    setupCsrf(true);
    mockGetMerchantBlogCacheIdentifiers.mockResolvedValue({
      identifiers: ['test-store', 'ogabassey.com'],
      canonicalMerchantSlug: 'test-store',
    });
    mockGetMerchantBlogPostCategories.mockResolvedValue(['reviews', 'laptops']);
    mockGetMerchantBlogPostSlugs.mockResolvedValue([
      'apple-studio-display-review',
      'airpods-max-2-2026',
    ]);
  });

  describe('CSRF protection', () => {
    it('returns 403 when CSRF check fails', async () => {
      const mockResponse = {
        status: 403,
        json: () => Promise.resolve({ error: 'CSRF validation failed' }),
      };
      setupCsrf(false);
      mockCheckCsrfProtection.mockResolvedValue({
        valid: false,
        response: mockResponse,
      });

      const res = await POST(makeRequest({ targets: ['products'] }));

      expect(res).toBe(mockResponse);
    });
  });

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      setupAuth(false);

      const res = await POST(makeRequest({ targets: ['products'] }));
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.error).toBe('Unauthorized');
    });

    it('returns 404 when merchant not found', async () => {
      mockAuthenticateApiRequest.mockResolvedValue({
        user: { id: 'user-123' },
        supabase: {},
        error: null,
      });
      mockGetUserAccess.mockResolvedValue(null);

      const res = await POST(makeRequest({ targets: ['products'] }));
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Merchant not found');
    });
  });

  describe('permissions', () => {
    it('returns 403 when a products-only request has neither settings:edit nor products:edit', async () => {
      setupAuth(true, false);

      const res = await POST(makeRequest({ targets: ['products'] }));
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toBe('Permission denied');
      expect(mockHasPermission).toHaveBeenCalledWith(
        expect.anything(),
        'settings',
        'edit'
      );
    });

    it('allows a products-only purge for staff with products:edit but not settings:edit', async () => {
      setupAuth(true, true);
      // Staff who can edit products but not settings — the mobile-admin save
      // and quick-action paths run as this kind of user.
      mockHasPermission.mockImplementation(
        (_access: unknown, resource: string, action: string) =>
          resource === 'products' && action === 'edit'
      );

      const res = await POST(
        makeRequest({
          targets: ['products'],
          products: [
            { slug: 'iphone-15', id: 'prod-1', category: 'Smartphones' },
          ],
        })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.revalidated).toContain('products');
      // The staff-scoped product purge still fires for the server-resolved slug.
      expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
        'ogabassey',
        [{ slug: 'iphone-15', categorySegment: 'smartphones' }]
      );
      expect(mockExpireProductBlogCache).toHaveBeenCalledWith(MERCHANT_ID);
    });

    it('allows a products-only purge for staff with products:create only (mobile create flow)', async () => {
      setupAuth(true, true);
      mockHasPermission.mockImplementation(
        (_access: unknown, resource: string, action: string) =>
          resource === 'products' && action === 'create'
      );

      const res = await POST(
        makeRequest({
          targets: ['products'],
          products: [{ slug: 'new-gadget', id: 'prod-9' }],
        })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.revalidated).toContain('products');
      expect(mockScheduleStorefrontProductPurge).toHaveBeenCalled();
    });

    it('prefers the authoritative row category (join) over the caller text hint', async () => {
      setupAuth(true, true);
      mockHasPermission.mockImplementation(
        (_access: unknown, resource: string, action: string) =>
          resource === 'products' && action === 'edit'
      );
      // The caller (mobile) only knows the legacy text "Audio", but the row's
      // direct category_id join says the canonical lives under "earbuds".
      productCategoryRows = [
        {
          id: 'prod-1',
          slug: 'buds-pro',
          name: 'Buds Pro',
          category: 'Audio',
          categories: { slug: 'earbuds' },
          product_categories: [],
        },
      ];

      const res = await POST(
        makeRequest({
          targets: ['products'],
          products: [{ slug: 'buds-pro', id: 'prod-1', category: 'Audio' }],
        })
      );

      expect(res.status).toBe(200);
      expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
        'ogabassey',
        [{ slug: 'buds-pro', categorySegment: 'earbuds' }]
      );
    });

    it('requires settings:edit for non-product legs even when the caller has products:edit', async () => {
      setupAuth(true, true);
      mockHasPermission.mockImplementation(
        (_access: unknown, resource: string, action: string) =>
          resource === 'products' && action === 'edit'
      );

      const res = await POST(
        makeRequest({ targets: ['products', 'merchant'] })
      );
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toBe('Permission denied');
    });

    it('requires settings:edit for the catch-all `all` target', async () => {
      setupAuth(true, true);
      mockHasPermission.mockImplementation(
        (_access: unknown, resource: string, action: string) =>
          resource === 'products' && action === 'edit'
      );

      const res = await POST(makeRequest({ targets: ['all'] }));

      expect(res.status).toBe(403);
    });
  });

  describe('multi-merchant merchantId verification', () => {
    it('does not re-verify when no merchantId is supplied (default single-merchant path)', async () => {
      setupAuth(true, true);

      const res = await POST(
        makeRequest({
          targets: ['products'],
          products: [{ slug: 'iphone-15', id: 'prod-1' }],
        })
      );

      expect(res.status).toBe(200);
      // No client merchantId → the default get_user_access merchant is used and
      // the scoped re-resolution never runs.
      expect(mockGetMerchantForApiRequest).not.toHaveBeenCalled();
      expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
        'ogabassey',
        [{ slug: 'iphone-15', categorySegment: null }]
      );
    });

    it('does not re-verify when the supplied merchantId equals the default access merchant', async () => {
      setupAuth(true, true);

      const res = await POST(
        makeRequest({
          targets: ['products'],
          merchantId: MERCHANT_ID,
          products: [{ slug: 'iphone-15', id: 'prod-1' }],
        })
      );

      expect(res.status).toBe(200);
      expect(mockGetMerchantForApiRequest).not.toHaveBeenCalled();
    });

    it('verifies access and purges the named merchant when the caller belongs to it', async () => {
      setupAuth(true, true);
      // The active merchant differs from the caller's default access merchant.
      mockGetMerchantForApiRequest.mockResolvedValue({
        merchantId: OTHER_MERCHANT_ID,
        merchantSlug: 'other-merchant',
        staffAccess: {
          isStaff: true,
          isOwner: false,
          role: 'manager',
          permissions: { products: { edit: true } },
        },
      });
      mockToUserAccess.mockReturnValue({
        merchantId: OTHER_MERCHANT_ID,
        role: 'manager',
        isOwner: false,
        isStaff: true,
        permissions: { products: { edit: true } },
      });
      mockHasPermission.mockImplementation(
        (_access: unknown, resource: string, action: string) =>
          resource === 'products' && action === 'edit'
      );
      // The server-resolved slug for the VERIFIED merchant.
      merchantSlugRow = { slug: 'other-merchant' };

      const res = await POST(
        makeRequest({
          targets: ['products'],
          merchantId: OTHER_MERCHANT_ID,
          products: [{ slug: 'buds-pro', id: 'prod-1' }],
        })
      );

      expect(res.status).toBe(200);
      // Verification ran against the CLIENT-supplied merchant id + the auth user.
      expect(mockGetMerchantForApiRequest).toHaveBeenCalledWith(
        expect.anything(),
        'user-123',
        { requestedMerchantId: OTHER_MERCHANT_ID }
      );
      // The purge targets the VERIFIED merchant's server-resolved slug.
      expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
        'other-merchant',
        [{ slug: 'buds-pro', categorySegment: null }]
      );
    });

    it('returns 403 and does not purge when the caller has no access to the named merchant', async () => {
      setupAuth(true, true);
      // Caller does NOT own / staff the requested merchant → no membership.
      mockGetMerchantForApiRequest.mockResolvedValue(null);

      const res = await POST(
        makeRequest({
          targets: ['products'],
          merchantId: OTHER_MERCHANT_ID,
          products: [{ slug: 'buds-pro', id: 'prod-1' }],
        })
      );
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toBe('Permission denied');
      // Hard 403 — never a silent fall-back to the default merchant.
      expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    it('returns 400 when targets array is empty', async () => {
      setupAuth(true, true);

      const res = await POST(makeRequest({ targets: [] }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Invalid input');
      expect(json.code).toBe('INVALID_INPUT');
      expect(json.details.fieldErrors.targets).toContain(
        'At least one target is required'
      );
    });

    it('returns 400 when targets is missing', async () => {
      setupAuth(true, true);

      const res = await POST(makeRequest({}));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Invalid input');
      expect(json.code).toBe('INVALID_INPUT');
      expect(json.details.fieldErrors.targets).toContain(
        'Invalid input: expected array, received undefined'
      );
    });

    it('returns 400 when targets contains invalid value', async () => {
      setupAuth(true, true);

      const res = await POST(makeRequest({ targets: ['invalid_target'] }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Invalid input');
      expect(json.code).toBe('INVALID_INPUT');
      expect(json.details.fieldErrors.targets).toContain(
        'Invalid option: expected one of "products"|"categories"|"merchant"|"blog"|"reviews"|"features"|"pages"|"all"'
      );
    });

    it('accepts all valid target types', async () => {
      setupAuth(true, true);

      const validTargets = [
        'products',
        'categories',
        'merchant',
        'blog',
        'reviews',
        'features',
        'pages',
        'all',
      ];

      const res = await POST(makeRequest({ targets: validTargets }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
    });
  });

  describe('revalidation - specific targets', () => {
    it('revalidates products cache when products target specified', async () => {
      setupAuth(true, true);

      const res = await POST(makeRequest({ targets: ['products'] }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.revalidated).toContain('products');

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `products-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'product-details',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getCategoryPageDataCacheTag(MERCHANT_ID),
        'storefront-page'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `dashboard-${MERCHANT_ID}`,
        'merchant'
      );
    });

    it('does NOT schedule a product purge when no products are supplied', async () => {
      setupAuth(true, true);

      await POST(makeRequest({ targets: ['products'] }));

      expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
    });

    it('schedules a Cloudflare product purge for supplied products (mobile-admin save path)', async () => {
      setupAuth(true, true);

      const res = await POST(
        makeRequest({
          targets: ['products'],
          products: [
            { slug: 'iphone-15', id: 'prod-1', category: 'Smartphones' },
          ],
        })
      );

      expect(res.status).toBe(200);
      // The merchant slug is resolved server-side (never trusted from the client).
      expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
        'ogabassey',
        [{ slug: 'iphone-15', categorySegment: 'smartphones' }]
      );
    });

    it('busts the per-slug Next product caches BEFORE scheduling the purge (F3)', async () => {
      setupAuth(true, true);

      await POST(
        makeRequest({
          targets: ['products'],
          products: [
            { slug: 'iphone-15', id: 'prod-1', category: 'Smartphones' },
          ],
        })
      );

      // The per-slug scoped product tag (getCachedProduct) is invalidated for the
      // resolved slug so a CF MISS after the purge cannot refill from stale Next
      // data. The slug-less revalidateProducts alone would never bust it.
      const scopedTag = getProductScopedCacheTag(
        'product',
        MERCHANT_ID,
        'iphone-15'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(scopedTag, 'products');

      // Ordering: the per-slug tag is busted before the edge purge is scheduled.
      const scopedCallIndex = mockRevalidateTag.mock.calls.findIndex(
        ([tag]) => tag === scopedTag
      );
      const scopedOrder =
        mockRevalidateTag.mock.invocationCallOrder[scopedCallIndex];
      const scheduleOrder =
        mockScheduleStorefrontProductPurge.mock.invocationCallOrder[0];
      expect(scopedOrder).toBeLessThan(scheduleOrder);
    });

    it('does not purge when the merchant has no resolvable slug', async () => {
      setupAuth(true, true);
      merchantSlugRow = { slug: null };

      await POST(
        makeRequest({
          targets: ['products'],
          products: [{ slug: 'iphone-15', category: 'Smartphones' }],
        })
      );

      expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
      // The per-slug Next cache bust only needs merchantId, not the storefront
      // slug, so it must still run even though the Cloudflare purge is skipped.
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getProductScopedCacheTag('product', MERCHANT_ID, 'iphone-15'),
        'products'
      );
    });

    it('logs and still purges from caller hints when the authoritative product-row lookup errors', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      try {
        setupAuth(true, true);
        // The authoritative row lookup fails, but the merchant slug still
        // resolves — the purge must fail open onto the caller's flat text hint.
        productRowsError = { message: 'db unavailable' };

        const res = await POST(
          makeRequest({
            targets: ['products'],
            products: [{ slug: 'buds-pro', id: 'prod-1', category: 'Audio' }],
          })
        );

        expect(res.status).toBe(200);
        // Fell back to the caller's "Audio" text hint (→ "audio") for the segment.
        expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
          'ogabassey',
          [{ slug: 'buds-pro', categorySegment: 'audio' }]
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            'Failed to resolve authoritative product rows'
          ),
          expect.objectContaining({
            merchantId: MERCHANT_ID,
            error: { message: 'db unavailable' },
          })
        );
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it('resolves previousCategoryId to the old slug and appends the old-category purge (category_id-only move)', async () => {
      setupAuth(true, true);
      // The authoritative row lives under "smartphones"; the pre-save category
      // (id-only move, blank legacy text) resolves to "phones".
      productCategoryRows = [
        {
          id: 'prod-1',
          slug: 'iphone-15',
          name: 'iPhone 15',
          category: 'Smartphones',
          categories: null,
          product_categories: [],
        },
      ];
      categoryRows = [{ id: 'cat-old', slug: 'phones' }];

      const res = await POST(
        makeRequest({
          targets: ['products'],
          products: [
            {
              slug: 'iphone-15',
              id: 'prod-1',
              category: 'Smartphones',
              previousCategoryId: 'cat-old',
            },
          ],
        })
      );

      expect(res.status).toBe(200);
      // Primary entry purges the NEW location; the appended hint-only entry
      // purges the OLD ("phones") listing + canonical PDP.
      expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
        'ogabassey',
        [
          { slug: 'iphone-15', categorySegment: 'smartphones' },
          { slug: 'iphone-15', categorySegment: 'phones' },
        ]
      );
    });

    it('does not append an old-category purge when the previous category resolves to the same segment', async () => {
      setupAuth(true, true);
      // The pre-save category resolves to the SAME "smartphones" segment as the
      // current one → no real move → no old-segment purge.
      categoryRows = [{ id: 'cat-old', slug: 'smartphones' }];

      const res = await POST(
        makeRequest({
          targets: ['products'],
          products: [
            {
              slug: 'iphone-15',
              id: 'prod-1',
              category: 'Smartphones',
              previousCategoryId: 'cat-old',
            },
          ],
        })
      );

      expect(res.status).toBe(200);
      expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
        'ogabassey',
        [{ slug: 'iphone-15', categorySegment: 'smartphones' }]
      );
    });

    it('fails open to the current-location purge when the previous-category slug lookup errors', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      try {
        setupAuth(true, true);
        // The old-category slug lookup fails; the current-location purge must
        // still fire (the stale old page self-heals on its TTL).
        categoryRowsError = { message: 'db unavailable' };

        const res = await POST(
          makeRequest({
            targets: ['products'],
            products: [
              {
                slug: 'iphone-15',
                id: 'prod-1',
                category: 'Smartphones',
                previousCategoryId: 'cat-old',
              },
            ],
          })
        );

        expect(res.status).toBe(200);
        // Only the current-location entry — the old-segment append is skipped.
        expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
          'ogabassey',
          [{ slug: 'iphone-15', categorySegment: 'smartphones' }]
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Failed to resolve previous category slugs'),
          expect.objectContaining({
            merchantId: MERCHANT_ID,
            error: { message: 'db unavailable' },
          })
        );
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it('logs and skips the (survivable) purge when the merchant slug lookup errors', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      try {
        setupAuth(true, true);
        merchantSlugError = { message: 'db unavailable' };

        const res = await POST(
          makeRequest({
            targets: ['products'],
            products: [
              { slug: 'iphone-15', id: 'prod-1', category: 'Smartphones' },
            ],
          })
        );

        // Revalidation still succeeds; only the fail-open purge is skipped.
        expect(res.status).toBe(200);
        expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
        // The merchantSlug guard covers ONLY the Cloudflare edge purge — the
        // Next-layer per-slug busting is independent (only needs merchantId)
        // and must still run when the slug lookup fails.
        expect(mockRevalidateTag).toHaveBeenCalledWith(
          getProductScopedCacheTag('product', MERCHANT_ID, 'iphone-15'),
          'products'
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

    it('revalidates categories cache when categories target specified', async () => {
      setupAuth(true, true);

      const res = await POST(makeRequest({ targets: ['categories'] }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.revalidated).toContain('categories');

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `categories-${MERCHANT_ID}`,
        'categories'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getCategoryPageDataCacheTag(MERCHANT_ID),
        'storefront-page'
      );
    });

    it('revalidates merchant cache when merchant target specified', async () => {
      setupAuth(true, true);

      const res = await POST(makeRequest({ targets: ['merchant'] }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.revalidated).toContain('merchant');

      expect(mockRevalidateTag).toHaveBeenCalledWith('merchants', 'merchant');
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `merchant-id-${MERCHANT_ID}`,
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `dashboard-${MERCHANT_ID}`,
        'merchant'
      );
    });

    it('revalidates blog cache when blog target specified', async () => {
      setupAuth(true, true);

      const res = await POST(makeRequest({ targets: ['blog'] }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.revalidated).toContain('blog');

      expect(mockGetMerchantBlogCacheIdentifiers).toHaveBeenCalledWith(
        expect.anything(),
        MERCHANT_ID
      );
      expect(mockGetMerchantBlogPostSlugs).toHaveBeenCalledWith(
        expect.anything(),
        MERCHANT_ID
      );
      expect(mockGetMerchantBlogPostCategories).toHaveBeenCalledWith(
        expect.anything(),
        MERCHANT_ID
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'blog-list-test-store-all-1',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'blog-list-ogabassey.com-all-1',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'blog-list-test-store-reviews-1',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'blog-list-test-store-laptops-1',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'blog-list-ogabassey.com-reviews-1',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'blog-list-ogabassey.com-laptops-1',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getBlogCacheTag('test-store', 'apple-studio-display-review'),
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getBlogCacheTag('test-store', 'airpods-max-2-2026'),
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getBlogCacheTag('ogabassey.com', 'apple-studio-display-review'),
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getBlogCacheTag('ogabassey.com', 'airpods-max-2-2026'),
        'merchant'
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith('/test-store/blog');
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        '/test-store/blog/apple-studio-display-review'
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        '/test-store/blog/airpods-max-2-2026'
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith('/ogabassey.com/blog');
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        '/ogabassey.com/blog/apple-studio-display-review'
      );
      expect(mockRevalidatePath).toHaveBeenCalledWith(
        '/ogabassey.com/blog/airpods-max-2-2026'
      );
    });

    it('revalidates additional blog listing pages when the merchant has multiple pages of posts', async () => {
      setupAuth(true, true);
      mockGetMerchantBlogPostSlugs.mockResolvedValue([
        'apple-studio-display-review',
        'airpods-max-2-2026',
        'post-3',
        'post-4',
        'post-5',
        'post-6',
        'post-7',
        'post-8',
        'post-9',
        'post-10',
        'post-11',
        'post-12',
        'post-13',
      ]);

      const res = await POST(makeRequest({ targets: ['blog'] }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.revalidated).toContain('blog');
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'blog-list-test-store-all-2',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'blog-list-ogabassey.com-all-2',
        'merchant'
      );
    });

    it('skips blog revalidation when blog cache identifiers lookup fails', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      try {
        setupAuth(true, true);
        mockGetMerchantBlogCacheIdentifiers.mockRejectedValueOnce(
          new Error('lookup failed')
        );

        const res = await POST(makeRequest({ targets: ['blog'] }));
        const json = await res.json();

        expect(res.status).toBe(500);
        expect(json.error).toBe('Cache purge failed for: blog');
        expect(json.revalidated).not.toContain('blog');
        expect(json.failedTargets).toEqual(['blog']);
        expect(mockRevalidateTag).not.toHaveBeenCalledWith(
          'blog-posts',
          'merchant'
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to revalidate blog caches:',
          expect.objectContaining({
            merchantId: MERCHANT_ID,
            error: expect.any(Error),
          })
        );
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it('revalidates reviews cache when reviews target specified', async () => {
      setupAuth(true, true);

      const res = await POST(makeRequest({ targets: ['reviews'] }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.revalidated).toContain('reviews');

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `reviews-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `rating-stats-${MERCHANT_ID}`,
        'products'
      );
    });

    it('revalidates features cache when features target specified', async () => {
      setupAuth(true, true);

      const res = await POST(makeRequest({ targets: ['features'] }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.revalidated).toContain('features');

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `features-${MERCHANT_ID}`,
        'merchant'
      );
    });

    it('revalidates pages cache when pages target specified', async () => {
      setupAuth(true, true);

      const res = await POST(makeRequest({ targets: ['pages'] }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.revalidated).toContain('pages');

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'page-config',
        'storefront-page'
      );
    });
  });

  describe('revalidation - multiple targets', () => {
    it('revalidates multiple caches when multiple targets specified', async () => {
      setupAuth(true, true);

      const res = await POST(
        makeRequest({ targets: ['products', 'merchant'] })
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.revalidated).toContain('products');
      expect(json.revalidated).toContain('merchant');
      expect(json.message).toContain('products');
      expect(json.message).toContain('merchant');

      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `products-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith('merchants', 'merchant');
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `dashboard-${MERCHANT_ID}`,
        'merchant'
      );
    });

    it('does not revalidate tags for unspecified targets', async () => {
      setupAuth(true, true);

      await POST(makeRequest({ targets: ['products'] }));

      expect(mockRevalidateTag).not.toHaveBeenCalledWith(
        'merchants',
        'merchant'
      );
      expect(mockRevalidateTag).not.toHaveBeenCalledWith(
        'blog-posts',
        'merchant'
      );
      expect(mockRevalidateTag).not.toHaveBeenCalledWith(
        `reviews-${MERCHANT_ID}`,
        'products'
      );
    });
  });

  describe('revalidation - all target', () => {
    it('revalidates all caches when all target specified', async () => {
      setupAuth(true, true);

      const res = await POST(makeRequest({ targets: ['all'] }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.revalidated).toHaveLength(7);
      expect(json.revalidated).toEqual(
        expect.arrayContaining([
          'products',
          'categories',
          'merchant',
          'blog',
          'reviews',
          'features',
          'pages',
        ])
      );

      // Verify all tags were revalidated
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `products-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'product-details',
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `categories-${MERCHANT_ID}`,
        'categories'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getCategoryPageDataCacheTag(MERCHANT_ID),
        'storefront-page'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith('merchants', 'merchant');
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `merchant-id-${MERCHANT_ID}`,
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'blog-list-test-store-all-1',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        getBlogContentLinksCacheTag(MERCHANT_ID),
        'merchant'
      );
      expect(mockRevalidateTag).not.toHaveBeenCalledWith(
        'blog-content-links',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'blog-list-ogabassey.com-all-1',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `reviews-${MERCHANT_ID}`,
        'products'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `features-${MERCHANT_ID}`,
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'page-config',
        'storefront-page'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        `dashboard-${MERCHANT_ID}`,
        'merchant'
      );
    });

    it('revalidates all when all is combined with specific targets', async () => {
      setupAuth(true, true);

      const res = await POST(makeRequest({ targets: ['all', 'products'] }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.revalidated).toHaveLength(7);

      // Should have revalidated all categories
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'blog-list-test-store-all-1',
        'merchant'
      );
      expect(mockRevalidateTag).toHaveBeenCalledWith(
        'page-config',
        'storefront-page'
      );
    });
  });

  describe('dashboard revalidation', () => {
    it('revalidates dashboard cache for products and merchant targets', async () => {
      setupAuth(true, true);

      // Only products and merchant trigger dashboard revalidation
      for (const target of ['products', 'merchant']) {
        mockRevalidateTag.mockClear();
        await POST(makeRequest({ targets: [target] }));

        expect(mockRevalidateTag).toHaveBeenCalledWith(
          `dashboard-${MERCHANT_ID}`,
          'merchant'
        );
      }
    });

    it('does not revalidate dashboard for other targets', async () => {
      setupAuth(true, true);

      for (const target of [
        'categories',
        'blog',
        'reviews',
        'features',
        'pages',
      ]) {
        mockRevalidateTag.mockClear();
        await POST(makeRequest({ targets: [target] }));

        expect(mockRevalidateTag).not.toHaveBeenCalledWith(
          `dashboard-${MERCHANT_ID}`,
          'merchant'
        );
      }
    });
  });

  describe('response format', () => {
    it('returns success with revalidated list and message', async () => {
      setupAuth(true, true);

      const res = await POST(
        makeRequest({ targets: ['products', 'merchant'] })
      );
      const json = await res.json();

      expect(json).toEqual({
        success: true,
        failedTargets: [],
        revalidated: expect.arrayContaining(['products', 'merchant']),
        message: expect.stringContaining('Cache purged for'),
      });
      expect(json.message).toContain('products');
      expect(json.message).toContain('merchant');
    });

    it('returns correct message format for single target', async () => {
      setupAuth(true, true);

      const res = await POST(makeRequest({ targets: ['products'] }));
      const json = await res.json();

      expect(json.message).toBe('Cache purged for: products');
    });
  });
});
