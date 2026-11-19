import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const MERCHANT_ID = 'merchant-123';
const PRODUCT_ID = 'product-456';

const mockRevalidateProducts = vi.fn((..._args: unknown[]) => true);
const mockRevalidateProductSlugs = vi.fn((..._args: unknown[]) => true);
const mockScheduleStorefrontProductPurge = vi.fn();
let product: Record<string, unknown> = {};
let updateResult: Record<string, unknown> = {};
const productSelectArgs: string[] = [];

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: vi.fn() }),
}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  hasPermission: vi.fn().mockReturnValue(true),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn().mockResolvedValue({
    merchantId: 'merchant-123',
    merchantSlug: 'test-store',
    businessName: 'Test Store',
    staffAccess: {
      isStaff: false,
      isOwner: true,
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
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
}));
vi.mock('@/lib/get-published-blog-post-slugs-for-products', () => ({
  getPublishedBlogPostSlugsForProducts: vi
    .fn()
    .mockResolvedValue({ slugs: [], incomplete: false }),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi
    .fn()
    .mockResolvedValue({ valid: true, response: null }),
}));
vi.mock('@/lib/embeddings', () => ({
  getProductEmbeddingText: vi.fn().mockReturnValue('product text'),
}));
vi.mock('@/lib/seo-utils', () => ({
  generateMetaDescription: (str: string) => `${str.substring(0, 50)}...`,
  generateProductSchema: () => ({ '@type': 'Product' }),
  generateProductSlug: (name: string) => name.toLowerCase().replace(/\s/g, '-'),
  generateSlug: (name: string) => name.toLowerCase().replace(/\s/g, '-'),
  getProductUrl: (p: {
    slug?: string;
    category?: string | null;
    categories?: { slug?: string; name?: string } | null;
    category_slug?: string | null;
  }) => {
    const segment =
      p.categories?.slug || p.category_slug || p.categories?.name || p.category;
    return segment
      ? `/${String(segment).toLowerCase().replace(/\s+/g, '-')}/${p.slug}`
      : `/products/${p.slug}`;
  },
}));
vi.mock('@/lib/countries', () => ({
  getCountryByCode: (code: string) => ({
    code,
    name: 'Test Country',
    currency: 'NGN',
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null }),
    },
    from: vi.fn((table: string) => {
      if (table === 'merchants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'merchant-123',
              business_name: 'Test Store',
              country: 'NG',
            },
            error: null,
          }),
        };
      }
      if (table === 'products') {
        const api = {
          select: vi.fn((arg?: string) => {
            if (typeof arg === 'string') productSelectArgs.push(arg);
            return api;
          }),
          eq: vi.fn(() => api),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          single: vi.fn().mockResolvedValue({ data: product, error: null }),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi
                    .fn()
                    .mockResolvedValue({ data: updateResult, error: null }),
                })),
              })),
            })),
          })),
        };
        return api;
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        returns: vi.fn().mockResolvedValue({ data: [], error: null }),
      };
    }),
  }),
}));

import { PUT } from './route';

const validUpdateBody = { name: 'Updated Product', price: 6000 };
const makePutRequest = (id: string) =>
  new NextRequest(`http://localhost:3000/api/products/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validUpdateBody),
  });

describe('PUT /api/products/[id] storefront purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    productSelectArgs.length = 0;
  });

  it('schedules a Cloudflare purge for the updated product and reads the category join', async () => {
    product = {
      id: PRODUCT_ID,
      name: 'Old Name',
      description: 'Old description',
      condition: 'new',
      slug: 'updated-product',
      category: 'Smartphones',
    };
    updateResult = { ...product, name: 'Updated Product' };

    const res = await PUT(makePutRequest(PRODUCT_ID), {
      params: Promise.resolve({ id: PRODUCT_ID }),
    });

    expect(res.status).toBe(200);
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      [{ slug: 'updated-product', categorySegment: 'smartphones' }]
    );
    expect(productSelectArgs[0]).toContain(
      'categories:category_id(slug, is_active)'
    );
  });

  it('busts per-slug Next caches (old + new) before the rename purge', async () => {
    product = {
      id: PRODUCT_ID,
      name: 'Old Name',
      description: 'Old description',
      condition: 'new',
      slug: 'old-name',
      category: 'Smartphones',
    };
    updateResult = {
      ...product,
      name: 'Updated Product',
      slug: 'updated-product',
    };

    await PUT(makePutRequest(PRODUCT_ID), {
      params: Promise.resolve({ id: PRODUCT_ID }),
    });

    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      MERCHANT_ID,
      undefined,
      { expireImmediately: true, omitMerchantWidePdpDetails: true }
    );
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
      MERCHANT_ID,
      expect.arrayContaining(['updated-product', 'old-name']),
      { expireImmediately: true }
    );
    expect(mockRevalidateProductSlugs.mock.invocationCallOrder[0]).toBeLessThan(
      mockScheduleStorefrontProductPurge.mock.invocationCallOrder[0]
    );
  });

  it('purges both the old and new slug and moves the OLD category segment when changed', async () => {
    product = {
      id: PRODUCT_ID,
      name: 'Old Name',
      description: 'Old description',
      condition: 'new',
      slug: 'old-name',
      category: 'Audio',
    };
    updateResult = {
      id: PRODUCT_ID,
      name: 'Updated Product',
      slug: 'updated-product',
      category: 'Smartphones',
    };

    const res = await PUT(makePutRequest(PRODUCT_ID), {
      params: Promise.resolve({ id: PRODUCT_ID }),
    });

    expect(res.status).toBe(200);
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      [
        { slug: 'updated-product', categorySegment: 'smartphones' },
        { slug: 'old-name', categorySegment: 'audio' },
      ]
    );
  });
});
