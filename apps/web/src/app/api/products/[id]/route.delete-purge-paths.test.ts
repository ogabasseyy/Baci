import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const MERCHANT_ID = 'merchant-123';
const PRODUCT_ID = 'product-456';

const mockRevalidateProducts = vi.fn((..._args: unknown[]) => true);
const mockRevalidateProductSlugs = vi.fn((..._args: unknown[]) => true);
const mockScheduleStorefrontProductPurge = vi.fn();
let productToDelete: unknown = null;
let deletedRow: { slug?: string | null } | null = null;
const productSelectArgs: string[] = [];
const productOps: string[] = [];

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
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null }),
    },
    from: vi.fn((table: string) => {
      if (table === 'products') {
        const deleteChain: {
          eq: ReturnType<typeof vi.fn>;
          select: ReturnType<typeof vi.fn>;
        } = {
          eq: vi.fn(() => deleteChain),
          select: vi.fn(() =>
            Promise.resolve({
              data: deletedRow ? [deletedRow] : [],
              error: null,
            })
          ),
        };
        const api = {
          select: vi.fn((arg?: string) => {
            if (typeof arg === 'string') productSelectArgs.push(arg);
            productOps.push('select');
            return api;
          }),
          eq: vi.fn(() => api),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          maybeSingle: vi.fn().mockResolvedValue({
            data: productToDelete,
            error: null,
          }),
          delete: vi.fn(() => {
            productOps.push('delete');
            return deleteChain;
          }),
        };
        return api;
      }
      if (table === 'blog_post_products') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
      };
    }),
  }),
}));

import { DELETE } from './route';

const makeDeleteRequest = (id: string) =>
  new NextRequest(`http://localhost:3000/api/products/${id}`, {
    method: 'DELETE',
  });

describe('DELETE /api/products/[id] storefront purge paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deletedRow = null;
    productSelectArgs.length = 0;
    productOps.length = 0;
  });

  it('schedules a Cloudflare purge and busts per-slug Next caches beforehand', async () => {
    productToDelete = {
      slug: 'iphone-15',
      name: 'iPhone 15',
      category: 'Smartphones',
    };

    const res = await DELETE(makeDeleteRequest(PRODUCT_ID), {
      params: Promise.resolve({ id: PRODUCT_ID }),
    });

    expect(res.status).toBe(200);
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      [{ slug: 'iphone-15', categorySegment: 'smartphones' }]
    );
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      MERCHANT_ID,
      undefined,
      { expireImmediately: true, omitMerchantWidePdpDetails: true }
    );
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
      MERCHANT_ID,
      ['iphone-15', PRODUCT_ID],
      { expireImmediately: true }
    );
    expect(mockRevalidateProductSlugs.mock.invocationCallOrder[0]).toBeLessThan(
      mockScheduleStorefrontProductPurge.mock.invocationCallOrder[0]
    );
  });

  it('also expires a slug changed concurrently between pre-read and delete', async () => {
    productToDelete = {
      slug: 'iphone-15',
      name: 'iPhone 15',
      category: 'Smartphones',
    };
    deletedRow = { slug: 'iphone-15-renamed' };

    const res = await DELETE(makeDeleteRequest(PRODUCT_ID), {
      params: Promise.resolve({ id: PRODUCT_ID }),
    });

    expect(res.status).toBe(200);
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
      MERCHANT_ID,
      ['iphone-15', 'iphone-15-renamed', PRODUCT_ID],
      { expireImmediately: true }
    );
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      [
        { slug: 'iphone-15', categorySegment: 'smartphones' },
        { slug: 'iphone-15-renamed', categorySegment: 'smartphones' },
      ]
    );
  });

  it('pre-reads the row with category_id join before deleting', async () => {
    productToDelete = {
      slug: 'iphone-15',
      name: 'iPhone 15',
      category: 'Smartphones',
      categories: { slug: 'smartphones' },
    };

    const res = await DELETE(makeDeleteRequest(PRODUCT_ID), {
      params: Promise.resolve({ id: PRODUCT_ID }),
    });

    expect(res.status).toBe(200);
    expect(productOps[0]).toBe('select');
    expect(productOps.indexOf('delete')).toBeGreaterThan(0);
    expect(
      productSelectArgs.some((arg) =>
        arg.includes('categories:category_id(slug, is_active)')
      )
    ).toBe(true);
  });

  it('purges the junction category and falls back to product id when slug is null', async () => {
    productToDelete = {
      slug: 'usb-c-cable',
      name: 'Cable',
      category: null,
      categories: null,
      product_categories: [{ categories: { slug: 'accessories' } }],
    };

    const res = await DELETE(makeDeleteRequest(PRODUCT_ID), {
      params: Promise.resolve({ id: PRODUCT_ID }),
    });

    expect(res.status).toBe(200);
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      [{ slug: 'usb-c-cable', categorySegment: 'accessories' }]
    );
    expect(
      productSelectArgs.some((arg) =>
        arg.includes(
          'product_categories(category_id, categories(slug, is_active))'
        )
      )
    ).toBe(true);

    vi.clearAllMocks();
    productToDelete = { slug: null, name: 'Legacy', category: null };
    await DELETE(makeDeleteRequest(PRODUCT_ID), {
      params: Promise.resolve({ id: PRODUCT_ID }),
    });
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      [{ slug: PRODUCT_ID, categorySegment: null }]
    );
  });

  it('completes the delete even when scheduling the purge throws', async () => {
    productToDelete = {
      slug: 'iphone-15',
      name: 'iPhone 15',
      category: 'Smartphones',
    };
    mockScheduleStorefrontProductPurge.mockImplementationOnce(() => {
      throw new Error('purge scheduling failed');
    });

    const res = await DELETE(makeDeleteRequest(PRODUCT_ID), {
      params: Promise.resolve({ id: PRODUCT_ID }),
    });
    expect(res.status).toBe(200);
  });
});
