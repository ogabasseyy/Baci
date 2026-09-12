import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_HERO_IMAGE_WIDTH_QUALITY_PAIRS } from '@/lib/ogabassey-image-prewarm-pairs';

// ---- Mocks ----

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
    set: vi.fn(),
  }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  hasPermission: vi.fn().mockReturnValue(true),
}));

const merchantMock = { context: null as unknown };
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn(() => Promise.resolve(merchantMock.context)),
  toUserAccess: vi.fn().mockReturnValue({
    merchantId: 'merchant-123',
    role: 'owner',
    isOwner: true,
    isStaff: false,
    permissions: { full_access: { all: true } },
  }),
}));

const mockRevalidateProductSlugs = vi.fn();
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: vi.fn(),
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
}));

const mockScheduleStorefrontProductPurge = vi.fn();
const mockScheduleHostnamePurge = vi.fn();
vi.mock('@/lib/storefront-product-purge-hostnames', () => ({
  scheduleStorefrontHostnamePurge: (...args: unknown[]) =>
    mockScheduleHostnamePurge(...args),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
}));

const mockGetPublishedBlogPostSlugsForProducts = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/get-published-blog-post-slugs-for-products', () => ({
  getPublishedBlogPostSlugsForProducts: (...args: unknown[]) =>
    mockGetPublishedBlogPostSlugsForProducts(...args),
}));

const mockPrewarmOgabasseyImageTransforms = vi
  .fn()
  .mockResolvedValue(undefined);
vi.mock('@/lib/ogabassey-image-prewarm', () => ({
  prewarmOgabasseyImageTransforms: (...args: unknown[]) =>
    mockPrewarmOgabasseyImageTransforms(...args),
}));

let csrfValid = true;
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(() =>
    Promise.resolve({
      valid: csrfValid,
      response: csrfValid
        ? null
        : new Response(JSON.stringify({ error: 'CSRF validation failed' }), {
            status: 403,
          }),
    })
  ),
}));

vi.mock('@/lib/embeddings', () => ({
  getProductEmbeddingText: vi.fn().mockReturnValue('product text'),
}));

vi.mock('@/lib/sanitize', () => ({
  sanitizeHtml: (str: string) => str,
}));

vi.mock('@/lib/sanitize-core', () => ({
  isValidUuid: (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value
    ),
  sanitizeText: (str: string) => str,
  sanitizeSchemaMarkup: (obj: Record<string, unknown>) => obj,
}));

vi.mock('@/lib/seo-utils', () => ({
  generateMetaDescription: (str: string) => `${str.substring(0, 50)}...`,
  generateProductSchema: () => ({ '@type': 'Product' }),
  generateProductSlug: (name: string) => name.toLowerCase().replace(/\s/g, '-'),
  generateSlug: (name: string) => name.toLowerCase().replace(/\s/g, '-'),
  // Minimal canonical-path builder so resolveProductPurgeCategorySegment (the
  // real helper) resolves a category segment from the mocked product data,
  // honoring the join slug (from the direct or junction category) over the
  // legacy text — mirroring the real getProductUrl precedence.
  getProductUrl: (product: {
    slug?: string;
    category?: string | null;
    categories?: { slug?: string; name?: string } | null;
    category_slug?: string | null;
  }) => {
    const segment =
      product.categories?.slug ||
      product.category_slug ||
      product.categories?.name ||
      product.category;
    return segment
      ? `/${String(segment).toLowerCase().replace(/\s+/g, '-')}/${product.slug}`
      : `/products/${product.slug}`;
  },
}));

vi.mock('@/lib/countries', () => ({
  getCountryByCode: (code: string) => ({
    code,
    name: 'Test Country',
    currency: 'NGN',
  }),
}));

vi.mock('@/schemas/products', () => ({
  updateProductSchema: {
    safeParse: (data: Record<string, unknown>) => {
      if (data.price && typeof data.price === 'number' && data.price < 0) {
        return {
          success: false,
          error: {
            issues: [{ path: ['price'], message: 'Must be positive' }],
          },
        };
      }
      return { success: true, data: { ...data } };
    },
  },
  formatZodErrors: (error: { issues: { path: string[]; message: string }[] }) =>
    error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
}));

// Supabase mock
const MERCHANT_ID = 'merchant-123';
const USER_ID = 'user-123';
const PRODUCT_ID = 'product-456';
const VARIANT_ID = '953ba6ff-3e83-403a-a07c-8c5ff54ede98';
const ANCHOR_VARIANT_ID = 'a0b7c8d9-1111-4222-9333-444455556666';

let authUser: unknown = { id: USER_ID };
let merchant: unknown = {
  id: MERCHANT_ID,
  business_name: 'Test Store',
  country: 'NG',
};
let product: unknown = null;
let productError: unknown = null;
let variants: unknown[] = [];
let anchorVariants: unknown[] = [];
let updateResult: unknown = null;
let updateError: unknown = null;
let deleteError: unknown = null;
// The single product row the DELETE handler pre-reads (before the lean delete)
// to derive its Cloudflare purge inputs, or null when the product no longer
// exists. Returned by `.from('products').select(...).maybeSingle()`.
let productToDelete: unknown = null;
// Error returned by the DELETE handler's pre-read of the product's purge inputs
// (before the lean delete). When set with a null `productToDelete` and a
// successful delete, the handler schedules the id-based fallback purge.
let preReadError: unknown = null;
let variantInsertError: unknown = null;
let variantUpsertError: unknown = null;
let variantSyncError: { code?: string; message?: string } | null = null;
let lastRpcCall: {
  functionName: string;
  args: Record<string, unknown>;
} | null = null;
let lastProductUpdatePayload: unknown = null;
const productUpdatePayloads: unknown[] = [];
const lastVariantDeleteFilters: [string, unknown][] = [];
// Captures every `.from('products').select(...)` argument (e.g. the pre-update
// existingProduct fetch and the pre-delete purge-input fetch) so tests can
// assert the Cloudflare purge reads the direct category join (including its
// activity flag) and the ordered product_categories junction projection.
const productSelectArgs: string[] = [];
// Ordered log of `products` table operations ('select' / 'delete') so tests can
// assert the DELETE handler pre-reads the row BEFORE deleting it (the junction
// rows cascade away with the delete, so reading after would come back empty).
const productOps: string[] = [];
let linkedBlogPostRows: unknown[] = [];

const createMockSupabase = () => ({
  rpc: vi.fn((functionName: string, args: Record<string, unknown>) => {
    lastRpcCall = { functionName, args };
    return Promise.resolve({
      data: variantSyncError ? null : 1,
      error: variantSyncError,
    });
  }),
  auth: {
    getUser: vi.fn(() => {
      if (authUser === undefined) {
        return Promise.reject(new Error('Unexpected error'));
      }
      return Promise.resolve({
        data: { user: authUser },
        error: authUser ? null : { message: 'Not authenticated' },
      });
    }),
  },
  from: vi.fn((table: string) => {
    if (table === 'merchants') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(() =>
          Promise.resolve({
            data: merchant,
            error: null,
          })
        ),
        single: vi.fn(() =>
          Promise.resolve({
            data: merchant,
            error: merchant ? null : { message: 'Not found' },
          })
        ),
      };
    }
    if (table === 'products') {
      let eqCallCount = 0;
      const deleteChain: { eq: ReturnType<typeof vi.fn> } = {
        eq: vi.fn((): unknown => {
          eqCallCount++;
          // The route now runs a LEAN delete (`delete().eq('id').eq('merchant')`)
          // with no trailing select — the purge inputs are pre-read separately
          // via `select(...).maybeSingle()` before the delete.
          if (eqCallCount >= 2) {
            return Promise.resolve({ error: deleteError });
          }
          return deleteChain;
        }),
      };

      const productsApi: {
        select: ReturnType<typeof vi.fn>;
        eq: ReturnType<typeof vi.fn>;
        single: ReturnType<typeof vi.fn>;
        maybeSingle: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
        delete: ReturnType<typeof vi.fn>;
      } = {
        select: vi.fn((arg?: string) => {
          if (typeof arg === 'string') {
            productSelectArgs.push(arg);
          }
          productOps.push('select');
          return productsApi;
        }),
        eq: vi.fn(() => productsApi),
        single: vi.fn(() =>
          Promise.resolve({
            data: productError ? null : product,
            error: productError,
          })
        ),
        maybeSingle: vi.fn(() =>
          // The DELETE handler pre-reads the row's purge inputs here.
          Promise.resolve({
            data: productToDelete,
            error: preReadError,
          })
        ),
        update: vi.fn((payload: unknown) => {
          lastProductUpdatePayload = payload;
          productUpdatePayloads.push(payload);
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(() =>
                    Promise.resolve({
                      data: updateError ? null : updateResult,
                      error: updateError,
                    })
                  ),
                })),
              })),
            })),
          };
        }),
        delete: vi.fn(() => {
          eqCallCount = 0; // Reset counter
          productOps.push('delete');
          return deleteChain;
        }),
      };
      return productsApi;
    }
    if (table === 'blog_post_products') {
      const linkedPostsChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn((limit: number) => {
          return Promise.resolve({
            data: linkedBlogPostRows.slice(0, limit),
            error: null,
          });
        }),
      };
      return linkedPostsChain;
    }
    if (table === 'product_variants') {
      const variantSelectFilters: [string, unknown][] = [];
      const variantSelectChain: {
        eq: ReturnType<typeof vi.fn>;
        in: ReturnType<typeof vi.fn>;
        returns: ReturnType<typeof vi.fn>;
      } = {
        eq: vi.fn((column: string, value: unknown) => {
          variantSelectFilters.push([column, value]);
          return variantSelectChain;
        }),
        in: vi.fn(() => variantSelectChain),
        returns: vi.fn(() =>
          Promise.resolve({
            data: variantSelectFilters.some(
              ([column, value]) =>
                column === 'is_inventory_anchor' && value === true
            )
              ? anchorVariants
              : variants,
            error: null,
          })
        ),
      };
      let variantDeleteEqCallCount = 0;
      const variantDeleteChain: {
        eq: ReturnType<typeof vi.fn>;
        not: ReturnType<typeof vi.fn>;
      } = {
        eq: vi.fn((column: string, value: unknown) => {
          lastVariantDeleteFilters.push([column, value]);
          variantDeleteEqCallCount++;
          return variantDeleteEqCallCount >= 3
            ? Promise.resolve({ error: deleteError })
            : variantDeleteChain;
        }),
        not: vi.fn(() =>
          Promise.resolve({
            error: deleteError,
          })
        ),
      };
      return {
        select: vi.fn(() => variantSelectChain),
        eq: vi.fn(() => variantSelectChain),
        delete: vi.fn(() => variantDeleteChain),
        upsert: vi.fn(() =>
          Promise.resolve({
            error: variantUpsertError,
          })
        ),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() =>
              Promise.resolve({
                error: variantUpsertError,
              })
            ),
          })),
        })),
        insert: vi.fn(() =>
          Promise.resolve({
            error: variantInsertError,
          })
        ),
      };
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
      single: vi.fn(() => Promise.resolve({ data: null, error: null })),
    };
  }),
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createMockSupabase(),
}));

// Mock global fetch for embeddings
global.fetch = vi.fn().mockResolvedValue({ ok: true });

// ---- Import handlers AFTER mocks ----
import { DELETE, GET, PUT } from './route';

// ---- Helpers ----

const validUpdateBody = {
  name: 'Updated Product',
  price: 6000,
};

function makeGetRequest(id: string) {
  return new NextRequest(`http://localhost:3000/api/products/${id}`, {
    method: 'GET',
  });
}

function makePutRequest(id: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost:3000/api/products/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(id: string) {
  return new NextRequest(`http://localhost:3000/api/products/${id}`, {
    method: 'DELETE',
  });
}

function resetMocks() {
  authUser = { id: USER_ID };
  merchant = {
    id: MERCHANT_ID,
    business_name: 'Test Store',
    country: 'NG',
  };
  merchantMock.context = {
    merchantId: MERCHANT_ID,
    merchantSlug: 'test-store',
    businessName: 'Test Store',
    staffAccess: {
      isStaff: false,
      isOwner: true,
      role: null,
      permissions: { full_access: { all: true } },
    },
  };
  product = {
    id: PRODUCT_ID,
    name: 'Test Product',
    price: '5000',
    stock_quantity: 100,
    has_variants: false,
  };
  productError = null;
  variants = [];
  anchorVariants = [];
  updateResult = null;
  updateError = null;
  deleteError = null;
  productToDelete = null;
  preReadError = null;
  variantInsertError = null;
  variantUpsertError = null;
  variantSyncError = null;
  lastRpcCall = null;
  lastProductUpdatePayload = null;
  productUpdatePayloads.length = 0;
  lastVariantDeleteFilters.length = 0;
  productSelectArgs.length = 0;
  productOps.length = 0;
  linkedBlogPostRows = [];
  csrfValid = true;
}

// ---- Tests ----

describe('GET /api/products/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      authUser = null;

      const res = await GET(makeGetRequest(PRODUCT_ID), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.error).toBe('Unauthorized');
    });
  });

  describe('merchant lookup', () => {
    it('returns 404 when merchant not found', async () => {
      merchantMock.context = null;

      const res = await GET(makeGetRequest(PRODUCT_ID), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Merchant not found');
    });
  });

  describe('product lookup', () => {
    it('returns 404 when product not found', async () => {
      product = null;
      productError = { message: 'Not found' };

      const res = await GET(makeGetRequest(PRODUCT_ID), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Product not found');
    });
  });

  describe('success', () => {
    it('returns product by UUID', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Test Product',
        description: 'A great product',
        price: '5000',
        stock_quantity: 100,
        status: 'active',
        manage_stock: true,
        has_variants: false,
        images: [{ url: 'https://example.com/image.png' }],
        category: 'Electronics',
        sku: 'SKU-001',
        slug: 'test-product',
      };

      const res = await GET(makeGetRequest(PRODUCT_ID), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.product).toBeDefined();
      expect(json.product.name).toBe('Test Product');
      expect(json.product.id).toBe(PRODUCT_ID);
    });

    it('returns product by slug', async () => {
      const slug = 'test-product-slug';
      product = {
        id: PRODUCT_ID,
        name: 'Test Product',
        slug: slug,
        price: '5000',
        stock_quantity: 100,
        has_variants: false,
      };

      const res = await GET(makeGetRequest(slug), {
        params: Promise.resolve({ id: slug }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.product.slug).toBe(slug);
    });

    it('returns product with variants', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Test Product',
        has_variants: true,
        price: '5000',
      };

      variants = [
        {
          id: 'variant-1',
          product_id: PRODUCT_ID,
          merchant_id: MERCHANT_ID,
          attributes: { size: 'M', color: 'Red' },
          price_override: 5000,
          stock_quantity: 10,
          sku: 'SKU-M-RED',
        },
      ];

      const res = await GET(makeGetRequest(PRODUCT_ID), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.product.has_variants).toBe(true);
      expect(json.product.variants).toHaveLength(1);
      expect(json.product.variants[0].sku).toBe('SKU-M-RED');
    });
  });

  describe('error handling', () => {
    it('returns 500 on unexpected error', async () => {
      authUser = undefined;

      const res = await GET(makeGetRequest(PRODUCT_ID), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe('Internal server error');
    });
  });
});

describe('PUT /api/products/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      authUser = null;

      const res = await PUT(makePutRequest(PRODUCT_ID, validUpdateBody), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.error).toBe('Unauthorized');
    });
  });

  describe('CSRF protection', () => {
    it('returns 403 when CSRF check fails', async () => {
      csrfValid = false;

      const res = await PUT(makePutRequest(PRODUCT_ID, validUpdateBody), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toBe('CSRF validation failed');
    });
  });

  describe('validation', () => {
    it('returns 400 when price is negative', async () => {
      const res = await PUT(makePutRequest(PRODUCT_ID, { price: -100 }), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Validation failed');
    });

    it('rejects sku_matrix updates when a variant lacks condition', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Product',
        condition: 'new',
        has_variants: true,
        variant_model: 'legacy',
      };

      const res = await PUT(
        makePutRequest(PRODUCT_ID, {
          has_variants: true,
          variant_model: 'sku_matrix',
          variants: [
            {
              price_override: 7000,
              stock_quantity: 5,
            },
          ],
        }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe(
        'Every sku_matrix variant must include a condition.'
      );
      expect(lastProductUpdatePayload).toBeNull();
    });

    it('allows partial updates on existing sku_matrix products without resending variants', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Product',
        condition: 'new',
        has_variants: true,
        variant_model: 'sku_matrix',
      };

      updateResult = {
        id: PRODUCT_ID,
        name: 'Updated Product',
        slug: 'updated-product',
        has_variants: true,
        variant_model: 'sku_matrix',
      };

      const res = await PUT(
        makePutRequest(PRODUCT_ID, {
          has_variants: true,
          name: 'Updated Product',
        }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.product).toBeDefined();
      expect(lastProductUpdatePayload).toEqual(
        expect.objectContaining({
          has_variants: true,
          name: 'Updated Product',
        })
      );
    });
  });

  describe('product lookup', () => {
    it('returns 404 when product not found', async () => {
      product = null;
      productError = { message: 'Not found' };

      const res = await PUT(makePutRequest(PRODUCT_ID, validUpdateBody), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Product not found');
    });
  });

  describe('success', () => {
    it('updates product successfully', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Old Name',
        description: 'Old description',
        condition: 'new',
      };

      updateResult = {
        id: PRODUCT_ID,
        name: 'Updated Product',
        price: '6000',
        slug: 'updated-product',
      };

      const res = await PUT(makePutRequest(PRODUCT_ID, validUpdateBody), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.product).toBeDefined();
      expect(json.product.name).toBe('Updated Product');
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
      updateResult = {
        id: PRODUCT_ID,
        name: 'Updated Product',
        slug: 'updated-product',
        category: 'Smartphones',
      };

      const res = await PUT(makePutRequest(PRODUCT_ID, validUpdateBody), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });

      expect(res.status).toBe(200);
      // Slug and category are unchanged, so only the single (new) entry is
      // purged — no spurious old-slug/old-category entry.
      expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
        'test-store',
        [{ slug: 'updated-product', categorySegment: 'smartphones' }]
      );
      // The pre-update fetch must read the category_id join so the purge can
      // resolve the same join-driven canonical the storefront serves.
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
        id: PRODUCT_ID,
        name: 'Updated Product',
        slug: 'updated-product',
        category: 'Smartphones',
      };

      await PUT(makePutRequest(PRODUCT_ID, validUpdateBody), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });

      expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
        MERCHANT_ID,
        expect.arrayContaining(['updated-product', 'old-name'])
      );
      expect(
        mockRevalidateProductSlugs.mock.invocationCallOrder[0]
      ).toBeLessThan(
        mockScheduleStorefrontProductPurge.mock.invocationCallOrder[0]
      );
    });

    it('purges both the old and new slug when a rename changes the slug', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Old Name',
        description: 'Old description',
        condition: 'new',
        slug: 'old-name',
        category: 'Smartphones',
      };
      updateResult = {
        id: PRODUCT_ID,
        name: 'Updated Product',
        slug: 'updated-product',
        category: 'Smartphones',
      };

      const res = await PUT(makePutRequest(PRODUCT_ID, validUpdateBody), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });

      expect(res.status).toBe(200);
      expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
        'test-store',
        [
          { slug: 'updated-product', categorySegment: 'smartphones' },
          { slug: 'old-name', categorySegment: 'smartphones' },
        ]
      );
    });

    it('purges the OLD category segment (not the new one) when a rename also moves the category', async () => {
      // The OLD row lived at /audio/old-name; the update renames it AND moves it
      // to Smartphones. The old entry must carry the OLD segment (audio) so the
      // builder evicts /audio/old-name and the /audio listing — deriving the old
      // entry from the new segment would purge /smartphones/old-name (never
      // cached) and leave the stale /audio URLs live.
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

      const res = await PUT(makePutRequest(PRODUCT_ID, validUpdateBody), {
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

    it('purges the old category listing when only the category moves (slug unchanged)', async () => {
      // A category move without a rename still leaves /audio/gadget and the
      // /audio listing cached, so the old entry (same slug, OLD segment) is
      // pushed alongside the new one.
      product = {
        id: PRODUCT_ID,
        name: 'Gadget',
        description: 'Old description',
        condition: 'new',
        slug: 'gadget',
        category: 'Audio',
      };
      updateResult = {
        id: PRODUCT_ID,
        name: 'Gadget',
        slug: 'gadget',
        category: 'Smartphones',
      };

      const res = await PUT(makePutRequest(PRODUCT_ID, validUpdateBody), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });

      expect(res.status).toBe(200);
      expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
        'test-store',
        [
          { slug: 'gadget', categorySegment: 'smartphones' },
          { slug: 'gadget', categorySegment: 'audio' },
        ]
      );
    });

    it('purges the junction category when there is no direct join and no legacy text', async () => {
      // The product is assigned ONLY via the product_categories junction (no
      // category_id, no legacy text), so its canonical PDP still lives under the
      // junction category and must be purged there — not at /products/<slug>.
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

      const res = await PUT(makePutRequest(PRODUCT_ID, validUpdateBody), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });

      expect(res.status).toBe(200);
      expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
        'test-store',
        [{ slug: 'usb-c-cable', categorySegment: 'accessories' }]
      );
      // The pre-update fetch must read the junction embed too.
      expect(productSelectArgs[0]).toContain(
        'product_categories(category_id, categories(slug, is_active))'
      );
    });

    it('falls back to the product id for the purge target when the slug is null', async () => {
      // Legacy rows can have a null slug but stay addressable at /products/<id>.
      product = {
        id: PRODUCT_ID,
        name: 'Legacy',
        description: 'Old description',
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

      const res = await PUT(makePutRequest(PRODUCT_ID, validUpdateBody), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });

      expect(res.status).toBe(200);
      expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
        'test-store',
        [{ slug: PRODUCT_ID, categorySegment: null }]
      );
    });

    it('completes the update even when scheduling the purge throws', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Old Name',
        description: 'Old description',
        condition: 'new',
        slug: 'updated-product',
      };
      updateResult = {
        id: PRODUCT_ID,
        name: 'Updated Product',
        slug: 'updated-product',
        category: 'Smartphones',
      };
      mockScheduleStorefrontProductPurge.mockImplementationOnce(() => {
        throw new Error('purge scheduling failed');
      });

      const res = await PUT(makePutRequest(PRODUCT_ID, validUpdateBody), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });

      // The purge is best-effort; a scheduling failure must not fail the update.
      expect(res.status).toBe(200);
    });

    it('preserves explicit images when single-image fields are also provided', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Old Name',
        description: 'Old description',
        condition: 'new',
      };

      updateResult = {
        id: PRODUCT_ID,
        name: 'Updated Product',
        price: '6000',
        slug: 'updated-product',
      };

      const explicitImages = [
        {
          url: 'https://cdn.example.com/products/explicit.jpg',
          alt: 'Explicit image',
          order: 0,
        },
      ];

      const res = await PUT(
        makePutRequest(PRODUCT_ID, {
          ...validUpdateBody,
          images: explicitImages,
          image: 'https://cdn.example.com/products/legacy-small.jpg',
          imageLarge: 'https://cdn.example.com/products/legacy-large.jpg',
        }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );
      await res.json();

      expect(res.status).toBe(200);
      expect(lastProductUpdatePayload).toEqual(
        expect.objectContaining({
          images: explicitImages,
        })
      );
      // When an explicit images array is supplied, legacy single-image fields
      // must NOT be forwarded to the update payload.
      expect(lastProductUpdatePayload).not.toHaveProperty('image');
      expect(lastProductUpdatePayload).not.toHaveProperty('imageLarge');
    });

    it('syncs existing and new variants through the tenant-scoped RPC', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Product',
        condition: 'new',
      };

      updateResult = {
        id: PRODUCT_ID,
        has_variants: true,
      };
      variants = [{ id: VARIANT_ID }];

      const bodyWithVariants = {
        has_variants: true,
        variants: [
          {
            id: VARIANT_ID,
            product_id: 'attacker-product',
            merchant_id: 'attacker-merchant',
            attributes: { size: 'L' },
            price_override: 7000,
            stock_quantity: 5,
            sku: 'SKU-L',
          },
          {
            attributes: { size: 'M' },
            price_override: 6500,
            stock_quantity: 2,
            sku: 'SKU-M',
          },
        ],
      };

      const res = await PUT(makePutRequest(PRODUCT_ID, bodyWithVariants), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });
      await res.json();

      expect(res.status).toBe(200);
      expect(lastRpcCall).toEqual({
        functionName: 'sync_product_variants_for_product',
        args: {
          p_product_id: PRODUCT_ID,
          p_merchant_id: MERCHANT_ID,
          p_variants: [
            {
              id: VARIANT_ID,
              attributes: { size: 'L' },
              price_override: 7000,
              stock_quantity: 5,
              sku: 'SKU-L',
            },
            {
              id: undefined,
              attributes: { size: 'M' },
              price_override: 6500,
              stock_quantity: 2,
              sku: 'SKU-M',
            },
          ],
        },
      });
      expect(
        (lastRpcCall?.args.p_variants as Record<string, unknown>[])[0]
      ).not.toHaveProperty('product_id');
      expect(
        (lastRpcCall?.args.p_variants as Record<string, unknown>[])[0]
      ).not.toHaveProperty('merchant_id');
    });

    it('preserves existing variant stock when stock_quantity is omitted', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Product',
        condition: 'new',
      };

      updateResult = {
        id: PRODUCT_ID,
        has_variants: true,
      };
      variants = [{ id: VARIANT_ID }];

      const res = await PUT(
        makePutRequest(PRODUCT_ID, {
          has_variants: true,
          variants: [
            {
              id: VARIANT_ID,
              sku: 'SKU-L-UPDATED',
            },
          ],
        }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );
      await res.json();

      expect(res.status).toBe(200);
      expect(lastRpcCall).toEqual({
        functionName: 'sync_product_variants_for_product',
        args: {
          p_product_id: PRODUCT_ID,
          p_merchant_id: MERCHANT_ID,
          p_variants: [
            {
              id: VARIANT_ID,
              sku: 'SKU-L-UPDATED',
            },
          ],
        },
      });
    });

    it('allows partial sku_matrix variant updates for existing rows', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Product',
        slug: 'product',
        condition: 'new',
        has_variants: true,
        variant_model: 'sku_matrix',
      };

      updateResult = {
        id: PRODUCT_ID,
        has_variants: true,
        variant_model: 'sku_matrix',
      };
      variants = [{ id: VARIANT_ID }];

      const res = await PUT(
        makePutRequest(PRODUCT_ID, {
          has_variants: true,
          variant_model: 'sku_matrix',
          variants: [
            {
              id: VARIANT_ID,
              sku: 'SKU-L-UPDATED',
            },
          ],
        }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );
      await res.json();

      expect(res.status).toBe(200);
      expect(lastRpcCall?.args.p_variants).toEqual([
        {
          id: VARIANT_ID,
          sku: 'SKU-L-UPDATED',
        },
      ]);
    });

    it('normalizes uppercase variant IDs before ownership checks and RPC sync', async () => {
      const uppercaseVariantId = VARIANT_ID.toUpperCase();
      product = {
        id: PRODUCT_ID,
        name: 'Product',
        slug: 'product',
        condition: 'new',
        has_variants: true,
        variant_model: 'legacy',
      };

      updateResult = {
        id: PRODUCT_ID,
        has_variants: true,
      };
      variants = [{ id: VARIANT_ID }];

      const res = await PUT(
        makePutRequest(PRODUCT_ID, {
          has_variants: true,
          variants: [
            {
              id: uppercaseVariantId,
              sku: 'SKU-L-UPDATED',
            },
          ],
        }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );
      await res.json();

      expect(res.status).toBe(200);
      expect(lastRpcCall?.args.p_variants).toEqual([
        {
          id: VARIANT_ID,
          sku: 'SKU-L-UPDATED',
        },
      ]);
    });

    it('rejects duplicate variant IDs before applying product updates', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Product',
        slug: 'product',
        condition: 'new',
        has_variants: true,
        variant_model: 'legacy',
      };

      variants = [{ id: VARIANT_ID }];

      const res = await PUT(
        makePutRequest(PRODUCT_ID, {
          has_variants: true,
          variants: [
            { id: VARIANT_ID, sku: 'SKU-A' },
            { id: VARIANT_ID, sku: 'SKU-B' },
          ],
        }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Duplicate product variant update');
      expect(lastProductUpdatePayload).toBeNull();
      expect(lastRpcCall).toBeNull();
    });

    it('rejects stale or cross-tenant variant IDs without applying migration state', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Product',
        slug: 'product',
        condition: 'new',
        has_variants: true,
        variant_model: 'legacy',
      };

      updateResult = {
        id: PRODUCT_ID,
        slug: 'product',
        name: 'Product',
      };

      const res = await PUT(
        makePutRequest(PRODUCT_ID, {
          has_variants: true,
          variant_model: 'sku_matrix',
          variants: [
            {
              id: VARIANT_ID,
              attributes: { storage: '128GB' },
              condition: 'used',
              price_override: 7000,
              stock_quantity: 5,
            },
          ],
        }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Invalid product variant update');
      expect(lastProductUpdatePayload).toBeNull();
      expect(lastRpcCall).toBeNull();
    });

    it('does not enable variants or sync when only inventory anchors are submitted', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Product',
        slug: 'product',
        condition: 'new',
        has_variants: false,
        variant_model: 'legacy',
      };
      anchorVariants = [{ id: ANCHOR_VARIANT_ID }];
      updateResult = {
        id: PRODUCT_ID,
        slug: 'product',
        name: 'Product',
        has_variants: false,
      };

      const res = await PUT(
        makePutRequest(PRODUCT_ID, {
          variants: [
            {
              id: ANCHOR_VARIANT_ID,
              sku: 'ANCHOR-SYSTEM-ROW',
              stock_quantity: 999,
            },
          ],
        }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );

      expect(res.status).toBe(200);
      expect(lastProductUpdatePayload).toMatchObject({ has_variants: false });
      expect(lastRpcCall).toBeNull();
    });

    it('honors explicit variant disabling even when a stale variants array is submitted', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Product',
        slug: 'product',
        condition: 'new',
        has_variants: true,
        variant_model: 'legacy',
      };
      updateResult = {
        id: PRODUCT_ID,
        slug: 'product',
        name: 'Product',
        has_variants: false,
      };

      const res = await PUT(
        makePutRequest(PRODUCT_ID, {
          has_variants: false,
          variants: [
            {
              id: VARIANT_ID,
              sku: 'STALE-VARIANT',
              stock_quantity: 4,
            },
          ],
        }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );
      await res.json();

      expect(res.status).toBe(200);
      expect(productUpdatePayloads).toContainEqual(
        expect.objectContaining({ has_variants: false })
      );
      expect(lastRpcCall).toBeNull();
      expect(lastVariantDeleteFilters).toContainEqual([
        'is_inventory_anchor',
        false,
      ]);
    });

    it('syncs an explicit empty variants array so stale visible rows are cleared', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Product',
        slug: 'product',
        condition: 'new',
        has_variants: true,
        variant_model: 'legacy',
      };
      updateResult = {
        id: PRODUCT_ID,
        slug: 'product',
        name: 'Product',
        has_variants: false,
      };

      const res = await PUT(
        makePutRequest(PRODUCT_ID, {
          variants: [],
        }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );
      await res.json();

      expect(res.status).toBe(200);
      expect(lastProductUpdatePayload).toMatchObject({ has_variants: false });
      expect(lastRpcCall).toEqual({
        functionName: 'sync_product_variants_for_product',
        args: {
          p_product_id: PRODUCT_ID,
          p_merchant_id: MERCHANT_ID,
          p_variants: [],
        },
      });
      expect(lastVariantDeleteFilters).toHaveLength(0);
    });

    it('filters serialized inventory anchors before variant ownership validation', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Product',
        slug: 'product',
        condition: 'new',
        has_variants: true,
        variant_model: 'sku_matrix',
      };
      variants = [{ id: VARIANT_ID }];
      anchorVariants = [{ id: ANCHOR_VARIANT_ID }];
      updateResult = {
        id: PRODUCT_ID,
        slug: 'product',
        name: 'Product',
      };

      const res = await PUT(
        makePutRequest(PRODUCT_ID, {
          has_variants: true,
          variants: [
            {
              id: ANCHOR_VARIANT_ID,
              sku: 'ANCHOR-SYSTEM-ROW',
              stock_quantity: 999,
            },
            {
              id: VARIANT_ID,
              sku: 'SKU-EDITABLE',
              stock_quantity: 5,
            },
          ],
        }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );

      expect(res.status).toBe(200);
      expect(lastRpcCall?.args.p_variants).toEqual([
        {
          id: VARIANT_ID,
          sku: 'SKU-EDITABLE',
          stock_quantity: 5,
        },
      ]);
    });

    it('does not mark a product as migrated when variant sync fails', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Product',
        slug: 'product',
        condition: 'new',
        has_variants: true,
        variant_model: 'legacy',
      };

      updateResult = {
        id: PRODUCT_ID,
        slug: 'product',
        name: 'Product',
      };
      variantSyncError = { message: 'sync failed' };

      const res = await PUT(
        makePutRequest(PRODUCT_ID, {
          has_variants: true,
          variant_model: 'sku_matrix',
          variants: [
            {
              attributes: { storage: '128GB' },
              condition: 'used',
              price_override: 7000,
              stock_quantity: 5,
            },
          ],
        }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe('Failed to sync product variants');
      expect(lastProductUpdatePayload).not.toHaveProperty('migration_status');
      expect(lastProductUpdatePayload).not.toHaveProperty('variant_model');
    });

    it('syncs variants when the variants payload is provided without has_variants', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Product',
        slug: 'product',
        condition: 'new',
        has_variants: false,
        variant_model: 'legacy',
      };

      updateResult = {
        id: PRODUCT_ID,
        slug: 'product',
        name: 'Product',
      };
      variantSyncError = { message: 'sync failed' };

      const res = await PUT(
        makePutRequest(PRODUCT_ID, {
          variants: [
            {
              attributes: { storage: '128GB' },
              price_override: 7000,
              stock_quantity: 5,
            },
          ],
        }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe('Failed to sync product variants');
      expect(lastProductUpdatePayload).toEqual(
        expect.objectContaining({
          has_variants: true,
        })
      );
    });

    it('does not send migration_status on legacy-variant updates', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Product',
        condition: 'used',
        variant_model: 'legacy',
        migration_status: 'needs_review',
      };

      updateResult = {
        id: PRODUCT_ID,
        name: 'Updated Product',
        price: '6000',
        slug: 'updated-product',
      };
      variants = [{ id: VARIANT_ID }];

      const res = await PUT(
        makePutRequest(PRODUCT_ID, {
          name: 'Updated Product',
          variants: [
            {
              id: VARIANT_ID,
              attributes: { storage: '128GB' },
              price_override: 6000,
              stock_quantity: 5,
            },
          ],
        }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.product).toBeDefined();
      expect(lastProductUpdatePayload).toEqual(
        expect.objectContaining({
          variant_model: 'legacy',
        })
      );
      expect(lastProductUpdatePayload).not.toHaveProperty('migration_status');
    });

    it('marks reviewed sku_matrix products as migrated after a successful variant save', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Product',
        slug: 'product',
        condition: 'new',
        has_variants: true,
        variant_model: 'legacy',
        migration_status: 'needs_review',
      };

      updateResult = {
        id: PRODUCT_ID,
        slug: 'product',
        name: 'Product',
        has_variants: true,
        variant_model: 'sku_matrix',
      };
      variants = [{ id: VARIANT_ID }];

      const res = await PUT(
        makePutRequest(PRODUCT_ID, {
          has_variants: true,
          variant_model: 'sku_matrix',
          variants: [
            {
              id: VARIANT_ID,
              attributes: { storage: '128GB' },
              condition: 'used',
              price_override: 7000,
              stock_quantity: 5,
            },
          ],
        }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.product).toBeDefined();
      expect(lastProductUpdatePayload).toEqual(
        expect.objectContaining({
          variant_model: 'sku_matrix',
          migration_status: 'migrated',
        })
      );
    });

    it('deletes variants when has_variants is set to false', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Product',
        condition: 'new',
      };

      updateResult = {
        id: PRODUCT_ID,
        has_variants: false,
      };

      const res = await PUT(
        makePutRequest(PRODUCT_ID, { has_variants: false }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );
      await res.json();

      expect(res.status).toBe(200);
      expect(lastVariantDeleteFilters).toContainEqual([
        'is_inventory_anchor',
        false,
      ]);
    });
  });

  describe('CDN image-transform prewarm', () => {
    it('pre-warms the updated product images when the update writes the images column', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Old Name',
        condition: 'new',
      };
      updateResult = {
        id: PRODUCT_ID,
        name: 'Updated Product',
        price: '6000',
        slug: 'updated-product',
        images: [
          { url: 'https://cdn.ogabassey.com/core-assets/products/phone.avif' },
          'https://cdn.ogabassey.com/core-assets/products/phone-back.avif',
        ],
      };

      const res = await PUT(
        makePutRequest(PRODUCT_ID, {
          ...validUpdateBody,
          images: [
            {
              url: 'https://cdn.ogabassey.com/core-assets/products/phone.avif',
            },
          ],
        }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );

      expect(res.status).toBe(200);
      // Default product matrix (PDP hero + listing card) for EVERY image.
      expect(mockPrewarmOgabasseyImageTransforms).toHaveBeenCalledWith([
        'https://cdn.ogabassey.com/core-assets/products/phone.avif',
        'https://cdn.ogabassey.com/core-assets/products/phone-back.avif',
      ]);
      // Dedicated home-hero q70 warm — PRIMARY image only, own invocation, so
      // it never truncates the shared product coverage for multi-image updates.
      expect(mockPrewarmOgabasseyImageTransforms).toHaveBeenCalledWith(
        ['https://cdn.ogabassey.com/core-assets/products/phone.avif'],
        { widthQualityPairs: HOME_HERO_IMAGE_WIDTH_QUALITY_PAIRS }
      );
    });

    it('does not call the prewarm when the update does not touch the images column', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Old Name',
        condition: 'new',
      };
      // The refreshed row still carries the existing (already-warmed) images, but
      // this name/price-only edit never wrote them, so the prewarm must not fire.
      updateResult = {
        id: PRODUCT_ID,
        name: 'Updated Product',
        price: '6000',
        slug: 'updated-product',
        images: [
          { url: 'https://cdn.ogabassey.com/core-assets/products/phone.avif' },
        ],
      };

      const res = await PUT(makePutRequest(PRODUCT_ID, validUpdateBody), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });

      expect(res.status).toBe(200);
      expect(mockPrewarmOgabasseyImageTransforms).not.toHaveBeenCalled();
    });

    it('does not call the prewarm when the images column is written empty', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Old Name',
        condition: 'new',
      };
      updateResult = {
        id: PRODUCT_ID,
        name: 'Updated Product',
        price: '6000',
        slug: 'updated-product',
        images: [],
      };

      const res = await PUT(
        makePutRequest(PRODUCT_ID, { ...validUpdateBody, images: [] }),
        {
          params: Promise.resolve({ id: PRODUCT_ID }),
        }
      );

      expect(res.status).toBe(200);
      expect(mockPrewarmOgabasseyImageTransforms).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('returns 500 when update fails', async () => {
      product = {
        id: PRODUCT_ID,
        name: 'Product',
        condition: 'new',
      };

      updateError = { message: 'Update failed' };

      const res = await PUT(makePutRequest(PRODUCT_ID, validUpdateBody), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe('Failed to update product');
    });

    it('returns 500 on unexpected error', async () => {
      authUser = undefined;

      const res = await PUT(makePutRequest(PRODUCT_ID, validUpdateBody), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe('Internal server error');
    });
  });
});

describe('DELETE /api/products/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMocks();
  });

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      authUser = null;

      const res = await DELETE(makeDeleteRequest(PRODUCT_ID), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.error).toBe('Unauthorized');
    });
  });

  describe('CSRF protection', () => {
    it('returns 403 when CSRF check fails', async () => {
      csrfValid = false;

      const res = await DELETE(makeDeleteRequest(PRODUCT_ID), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toBe('CSRF validation failed');
    });
  });

  describe('success', () => {
    it('deletes product successfully', async () => {
      deleteError = null;
      productToDelete = {
        id: PRODUCT_ID,
        slug: 'phone',
        name: 'Phone',
        category: 'Electronics',
      };

      const res = await DELETE(makeDeleteRequest(PRODUCT_ID), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
    });

    it('does not pre-warm image transforms on delete (nothing left to serve)', async () => {
      deleteError = null;

      await DELETE(makeDeleteRequest(PRODUCT_ID), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });

      expect(mockPrewarmOgabasseyImageTransforms).not.toHaveBeenCalled();
    });

    it('schedules a Cloudflare purge for the deleted product', async () => {
      deleteError = null;
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
      // The deleted slug's Next cache tag is busted BEFORE the edge purge so a
      // post-purge MISS cannot refill a stale "product exists" page.
      expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(MERCHANT_ID, [
        'iphone-15',
      ]);
      expect(
        mockRevalidateProductSlugs.mock.invocationCallOrder[0]
      ).toBeLessThan(
        mockScheduleStorefrontProductPurge.mock.invocationCallOrder[0]
      );
    });

    it('pre-reads the row (select before delete) and reads the category_id join', async () => {
      deleteError = null;
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
      // The purge inputs must be read BEFORE the delete — the junction rows
      // cascade away with the delete, so a post-delete read would be empty.
      expect(productOps).toEqual(['select', 'delete']);
      // The pre-delete select must fetch the join so the purge resolves the same
      // join-driven canonical the storefront served (PR #2914).
      expect(
        productSelectArgs.some((arg) =>
          arg.includes('categories:category_id(slug, is_active)')
        )
      ).toBe(true);
    });

    it('does not purge a storefront for a nonexistent product', async () => {
      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      try {
        deleteError = null;
        // A successful empty read is not an inventory mutation.
        productToDelete = null;

        const res = await DELETE(makeDeleteRequest(PRODUCT_ID), {
          params: Promise.resolve({ id: PRODUCT_ID }),
        });

        expect(res.status).toBe(404);
        expect(mockScheduleHostnamePurge).not.toHaveBeenCalled();
        expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
      } finally {
        consoleWarnSpy.mockRestore();
      }
    });

    it('schedules a complete fallback purge when the pre-read errored but the delete succeeded', async () => {
      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      try {
        deleteError = null;
        productToDelete = null;
        preReadError = { message: 'read failed' };

        const res = await DELETE(makeDeleteRequest(PRODUCT_ID), {
          params: Promise.resolve({ id: PRODUCT_ID }),
        });

        expect(res.status).toBe(200);
        // The unknown old canonical path is covered by the hostname purge.
        expect(mockScheduleHostnamePurge).toHaveBeenCalledWith('test-store');
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          'Product purge pre-read failed after delete; scheduling complete fallback purge',
          expect.objectContaining({ id: PRODUCT_ID })
        );
      } finally {
        consoleWarnSpy.mockRestore();
      }
    });

    it('purges the junction category and reads the junction embed on the pre-delete select', async () => {
      deleteError = null;
      // Assigned ONLY via the product_categories junction (no category_id, no
      // legacy text) — the junction rows only exist BEFORE the cascading delete.
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
    });

    it('falls back to the product id for the purge when the deleted slug is null', async () => {
      deleteError = null;
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
      deleteError = null;
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

      // The purge is best-effort; a scheduling failure must not fail the delete.
      expect(res.status).toBe(200);
    });
  });

  describe('error handling', () => {
    it('returns 500 on unexpected error', async () => {
      authUser = undefined;

      const res = await DELETE(makeDeleteRequest(PRODUCT_ID), {
        params: Promise.resolve({ id: PRODUCT_ID }),
      });
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe('Internal server error');
    });
  });
});
