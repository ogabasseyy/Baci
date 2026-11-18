import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBulkUpdateRouteQueryBuilder } from './bulk-update-route-query-builder.test-support';

const MERCHANT_ID = 'merchant-123';
const mockGenerateProductSlug = vi.hoisted(() =>
  vi.fn((name: string) => name.toLowerCase().replace(/\s+/g, '-'))
);
const mockRevalidateProducts = vi.fn();
const mockRevalidateProductSlugs = vi.hoisted(() => vi.fn());
const mockScheduleStorefrontProductPurge = vi.fn();

let productUpdateSelectRows: Record<string, unknown>[] = [];

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
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
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi
    .fn()
    .mockResolvedValue({ valid: true, response: null }),
}));
vi.mock('@/lib/seo-utils', () => ({
  generateProductSlug: (name: string) =>
    mockGenerateProductSlug(name) as string,
  generateSlug: (name: string) => name.toLowerCase().replace(/\s+/g, '-'),
  getProductUrl: (product: {
    slug?: string | null;
    id?: string;
    category?: string | null;
    categories?: { name?: string; slug?: string } | null;
    category_slug?: string | null;
  }) => {
    const slug = product.slug || product.id || '';
    const segment =
      product.categories?.slug ||
      product.category_slug ||
      product.categories?.name ||
      product.category;
    return segment
      ? `/${String(segment).toLowerCase().replace(/\s+/g, '-')}/${slug}`
      : `/products/${slug}`;
  },
}));
vi.mock('@/lib/countries', () => ({
  getCountryByCode: (code: string) => ({
    code,
    name: 'Nigeria',
    currency: 'NGN',
  }),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn().mockResolvedValue({
    merchantId: 'merchant-123',
    merchantSlug: 'ogabassey',
    businessName: 'Test Store',
    staffAccess: {
      isOwner: true,
      isStaff: false,
      role: null,
      permissions: { full_access: { all: true } },
    },
  }),
  toUserAccess: vi.fn().mockReturnValue({
    merchantId: 'merchant-123',
    role: 'owner',
    isOwner: true,
    isStaff: false,
    permissions: { full_access: { all: true } },
  }),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: vi.fn() }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null }),
    },
    from: vi.fn((table: string) => {
      if (table === 'merchants') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: MERCHANT_ID,
                  business_name: 'Test Store',
                  country: 'NG',
                  payout_currency: 'NGN',
                },
                error: null,
              }),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: MERCHANT_ID,
                  business_name: 'Test Store',
                  country: 'NG',
                  payout_currency: 'NGN',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'products') {
        return {
          select: vi.fn(() =>
            createBulkUpdateRouteQueryBuilder(
              () => null,
              () => productUpdateSelectRows
            )
          ),
          update: vi.fn(() =>
            createBulkUpdateRouteQueryBuilder(
              () => null,
              () => productUpdateSelectRows
            )
          ),
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'created-id-1' },
                error: null,
              }),
            })),
          })),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    }),
  })),
}));

import { POST } from './route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/products/bulk-update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/products/bulk-update storefront purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRevalidateProducts.mockReturnValue(true);
    mockRevalidateProductSlugs.mockReturnValue(true);
    productUpdateSelectRows = [];
  });

  it('busts per-slug Next caches before scheduling the bulk purge', async () => {
    await POST(
      makeRequest({
        changes: [{ type: 'update', productId: 'p1', details: { price: 900 } }],
      })
    );

    expect(mockRevalidateProductSlugs).toHaveBeenCalled();
    const revalidateOrder =
      mockRevalidateProductSlugs.mock.invocationCallOrder[0];
    const purgeOrder =
      mockScheduleStorefrontProductPurge.mock.invocationCallOrder[0];
    expect(revalidateOrder).toBeLessThan(purgeOrder);
  });

  it('falls back to the product id for the purge target when the row slug is null', async () => {
    productUpdateSelectRows = [
      {
        id: 'legacy-id',
        slug: null,
        category: null,
        status: 'active',
        categories: null,
        product_categories: [],
      },
    ];

    await POST(
      makeRequest({
        changes: [
          {
            type: 'update',
            productId: 'legacy-id',
            details: { name: 'Legacy', price: 10 },
          },
        ],
      })
    );

    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'ogabassey',
      [{ slug: 'legacy-id', categorySegment: null }]
    );
  });

  it('forwards every high-cardinality product to the shared bounded purge scheduler', async () => {
    productUpdateSelectRows = Array.from({ length: 51 }, (_, index) => ({
      id: `p-${index}`,
      slug: `slug-${index}`,
      category: 'Electronics',
      status: 'active',
      categories: null,
      product_categories: [],
    }));

    await POST(
      makeRequest({
        changes: [
          {
            type: 'update',
            productId: 'product-1',
            details: { name: 'Bulk', price: 10 },
          },
        ],
      })
    );

    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'ogabassey',
      expect.arrayContaining([
        { slug: 'slug-0', categorySegment: 'electronics' },
        { slug: 'slug-50', categorySegment: 'electronics' },
      ])
    );
  });
});
