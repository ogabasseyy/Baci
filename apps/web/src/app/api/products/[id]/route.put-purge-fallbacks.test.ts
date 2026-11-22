import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PRODUCT_ID = 'product-456';

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
  revalidateProducts: vi.fn(() => true),
  revalidateProductSlugs: vi.fn(() => true),
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

const makePutRequest = (id: string) =>
  new NextRequest(`http://localhost:3000/api/products/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Updated Product', price: 6000 }),
  });

describe('PUT /api/products/[id] storefront purge fallbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    productSelectArgs.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('purges the old category listing when only the category moves', async () => {
    product = {
      id: PRODUCT_ID,
      name: 'Gadget',
      description: 'Old description',
      condition: 'new',
      slug: 'gadget',
      category: 'Audio',
    };
    updateResult = { ...product, category: 'Smartphones' };

    const res = await PUT(makePutRequest(PRODUCT_ID), {
      params: Promise.resolve({ id: PRODUCT_ID }),
    });

    expect(res.status).toBe(200);
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      [
        { slug: 'gadget', categorySegment: 'smartphones' },
        { slug: 'gadget', categorySegment: 'audio' },
        { slug: PRODUCT_ID, categorySegment: null },
      ]
    );
  });

  it('purges the junction category and falls back to product id when slug is null', async () => {
    product = {
      id: PRODUCT_ID,
      name: 'Cable',
      description: 'Old description',
      condition: 'new',
      slug: 'usb-c-cable',
      category: null,
      categories: null,
      product_categories: [{ categories: { slug: 'accessories' } }],
    };
    updateResult = {
      id: PRODUCT_ID,
      name: 'Cable',
      slug: 'usb-c-cable',
      category: null,
    };

    const res = await PUT(makePutRequest(PRODUCT_ID), {
      params: Promise.resolve({ id: PRODUCT_ID }),
    });
    expect(res.status).toBe(200);
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      [
        { slug: 'usb-c-cable', categorySegment: 'accessories' },
        { slug: PRODUCT_ID, categorySegment: null },
      ]
    );
    expect(productSelectArgs[0]).toContain(
      'product_categories(category_id, categories(slug, is_active))'
    );

    vi.clearAllMocks();
    product = {
      id: PRODUCT_ID,
      name: 'Legacy',
      description: 'Old',
      condition: 'new',
      slug: null,
      category: null,
    };
    updateResult = {
      id: PRODUCT_ID,
      name: 'Legacy',
      slug: null,
      category: null,
    };
    const idFallbackRes = await PUT(makePutRequest(PRODUCT_ID), {
      params: Promise.resolve({ id: PRODUCT_ID }),
    });
    expect(idFallbackRes.status).toBe(200);
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      [{ slug: PRODUCT_ID, categorySegment: null }]
    );
  });

  it('completes the update even when scheduling the purge throws', async () => {
    product = {
      id: PRODUCT_ID,
      name: 'Old',
      description: 'Old',
      condition: 'new',
      slug: 'updated-product',
    };
    updateResult = {
      ...product,
      name: 'Updated Product',
      category: 'Smartphones',
    };
    mockScheduleStorefrontProductPurge.mockImplementationOnce(() => {
      throw new Error('purge scheduling failed');
    });

    const res = await PUT(makePutRequest(PRODUCT_ID), {
      params: Promise.resolve({ id: PRODUCT_ID }),
    });
    expect(res.status).toBe(200);
  });
});
