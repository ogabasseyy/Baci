import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBulkUpdateRouteQueryBuilder } from './bulk-update-route-query-builder.test-support';

// ---- Mocks ----

const mockGenerateProductSlug = vi.hoisted(() =>
  vi.fn((name: string) => name.toLowerCase().replace(/\s+/g, '-'))
);

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
}));

const mockRevalidateProducts = vi.fn();
const mockRevalidateProductSlugs = vi.hoisted(() => vi.fn());
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
  revalidateProductSlugs: (...args: unknown[]) =>
    mockRevalidateProductSlugs(...args),
}));

const mockScheduleStorefrontProductPurge = vi.fn();
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mockScheduleStorefrontProductPurge(...args),
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

vi.mock('@/lib/seo-utils', () => ({
  generateProductSlug: (name: string) =>
    mockGenerateProductSlug(name) as string,
  generateSlug: (name: string) => name.toLowerCase().replace(/\s+/g, '-'),
  // Minimal stand-in used by resolveProductPurgeCategorySegment: build a
  // categorized PDP path from the resolved category (join slug/name/text) or
  // fall back to the /products path — enough to derive the leading segment.
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
    if (segment) {
      return `/${String(segment).toLowerCase().replace(/\s+/g, '-')}/${slug}`;
    }
    return `/products/${slug}`;
  },
}));

vi.mock('@/lib/countries', () => ({
  getCountryByCode: (code: string) => ({
    code,
    name: 'Nigeria',
    currency: 'NGN',
  }),
}));

type MerchantContextMock = {
  merchantId: string;
  merchantSlug?: string;
  businessName: string;
  staffAccess: {
    isOwner: boolean;
    isStaff: boolean;
    role: string | null;
    permissions: Record<string, Record<string, boolean>>;
  };
};

const merchantContextMock = {
  current: {
    merchantId: 'merchant-123',
    merchantSlug: 'ogabassey',
    businessName: 'Test Store',
    staffAccess: {
      isOwner: true,
      isStaff: false,
      role: null,
      permissions: { full_access: { all: true } },
    },
  } as MerchantContextMock | null,
};
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn(() =>
    Promise.resolve(merchantContextMock.current)
  ),
  toUserAccess: vi.fn((ctx: MerchantContextMock | null) => {
    if (!ctx) {
      throw new Error('Merchant context is required');
    }

    return {
      merchantId: ctx.merchantId,
      role: ctx.staffAccess.role ?? (ctx.staffAccess.isOwner ? 'owner' : null),
      isOwner: ctx.staffAccess.isOwner,
      isStaff: ctx.staffAccess.isStaff,
      permissions: ctx.staffAccess.permissions,
    };
  }),
}));

// Supabase mock
const MERCHANT_ID = 'merchant-123';
const USER_ID = 'user-123';

let authUser: { id: string } | null = { id: USER_ID };
let merchant: {
  id: string;
  business_name: string;
  country: string | null;
  payout_currency?: string | null;
} | null = {
  id: MERCHANT_ID,
  business_name: 'Test Store',
  country: 'NG',
  payout_currency: 'NGN',
};
let merchantError: unknown = null;
let updateError: unknown = null;
let insertError: unknown = null;
let productInserts: unknown[] = [];
let productUpdates: unknown[] = [];
// Rows returned before and after update/archive queries so the route can derive
// publication-state-aware Cloudflare purge targets.
let productUpdateSelectRows: unknown[] = [];

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
          data: { user: authUser },
          error: authUser ? null : { message: 'Not authenticated' },
        })
      ),
    },
    from: vi.fn((table: string) => {
      if (table === 'merchants') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn(() =>
                Promise.resolve({
                  data: merchant,
                  error: merchantError,
                })
              ),
              single: vi.fn(() =>
                Promise.resolve({
                  data: merchant,
                  error: merchant ? null : { message: 'Not found' },
                })
              ),
            }),
          }),
        };
      }
      if (table === 'products') {
        return {
          select: vi.fn(() =>
            createBulkUpdateRouteQueryBuilder(
              () => updateError,
              () => productUpdateSelectRows
            )
          ),
          update: vi.fn((payload: unknown) => {
            productUpdates.push(payload);
            return createBulkUpdateRouteQueryBuilder(
              () => updateError,
              () => productUpdateSelectRows
            );
          }),
          insert: vi.fn((payload: unknown) => {
            productInserts.push(payload);
            // Route chains .select('id').maybeSingle() to read the created id
            // (used for the blank-slug purge fallback).
            return {
              select: vi.fn(() => ({
                maybeSingle: vi.fn(() =>
                  Promise.resolve({
                    data: insertError ? null : { id: 'created-id-1' },
                    error: insertError,
                  })
                ),
              })),
            };
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

// ---- Helpers ----

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/products/bulk-update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---- Tests ----

describe('POST /api/products/bulk-update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser = { id: USER_ID };
    merchant = {
      id: MERCHANT_ID,
      business_name: 'Test Store',
      country: 'NG',
      payout_currency: 'NGN',
    };
    merchantContextMock.current = {
      merchantId: MERCHANT_ID,
      merchantSlug: 'ogabassey',
      businessName: 'Test Store',
      staffAccess: {
        isOwner: true,
        isStaff: false,
        role: null,
        permissions: { full_access: { all: true } },
      },
    };
    merchantError = null;
    updateError = null;
    insertError = null;
    productInserts = [];
    productUpdates = [];
    productUpdateSelectRows = [];
    csrfValid = true;
  });

  it('returns 500 when merchant details query fails', async () => {
    const { POST } = await import('./route');
    merchantError = { message: 'merchant lookup unavailable' };

    const response = await POST(makeRequest({ changes: [] }));
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('Failed to fetch merchant details');
    expect(mockRevalidateProducts).not.toHaveBeenCalled();
  });

  it('uses merchant context fallback when merchant details are absent', async () => {
    const { POST } = await import('./route');
    merchant = null;

    const response = await POST(makeRequest({ changes: [] }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(MERCHANT_ID);
  });

  it('returns 401 when not authenticated', async () => {
    const { POST } = await import('./route');
    authUser = null;

    const res = await POST(makeRequest({ changes: [] }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 404 when merchant not found', async () => {
    const { POST } = await import('./route');
    merchantContextMock.current = null;

    const res = await POST(makeRequest({ changes: [] }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Merchant not found');
  });

  it('returns 403 when CSRF validation fails', async () => {
    const { POST } = await import('./route');
    csrfValid = false;

    const res = await POST(makeRequest({ changes: [] }));

    expect(res.status).toBe(403);
  });

  it('returns 400 with flattened validation details for invalid changes data', async () => {
    const { POST } = await import('./route');

    const res = await POST(makeRequest({ changes: 'not-an-array' }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({
      error: 'Invalid changes data',
      details: {
        fieldErrors: {
          changes: [expect.stringContaining('expected array')],
        },
        formErrors: [],
      },
    });
  });

  it('returns 400 with top-level validation details for malformed payloads', async () => {
    const { POST } = await import('./route');

    const res = await POST(makeRequest('not-an-object'));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({
      error: 'Invalid changes data',
      details: {
        fieldErrors: {},
        formErrors: [expect.stringContaining('expected object')],
      },
    });
  });

  it('processes update changes and calls revalidateProducts', async () => {
    const { POST } = await import('./route');

    const changes = [
      {
        type: 'update',
        productId: 'product-1',
        newPrice: 150,
        details: {
          name: 'Updated Product',
          price: 150,
          cost_price: 90,
          category: 'Electronics',
        },
      },
    ];

    const res = await POST(makeRequest({ changes }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.results.updated).toBe(1);
    expect(productUpdates[0]).toMatchObject({
      category: 'Electronics',
      name: 'Updated Product',
      price: 150,
      cost_price: 90,
    });
    expect(mockRevalidateProducts).toHaveBeenCalledWith(MERCHANT_ID);
  });

  it('busts per-slug Next caches before scheduling the bulk purge', async () => {
    const { POST } = await import('./route');
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
    const { POST } = await import('./route');
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
    const { POST } = await import('./route');
    // The shared scheduler now owns the bounded hostname-purge strategy, so
    // this caller must not omit PDP entries from a large mutation.
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

  it('does not persist whitespace-only product names during targeted updates', async () => {
    const { POST } = await import('./route');

    const res = await POST(
      makeRequest({
        changes: [
          {
            type: 'update',
            productId: 'product-1',
            newPrice: 150,
            details: {
              name: '   ',
              price: 150,
              category: 'Electronics',
            },
          },
        ],
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results.updated).toBe(1);
    expect(productUpdates[0]).toMatchObject({
      category: 'Electronics',
      price: 150,
    });
    expect(productUpdates[0]).not.toHaveProperty('name');
  });

  it('preserves existing product names when targeted updates omit the name field', async () => {
    const { POST } = await import('./route');

    const res = await POST(
      makeRequest({
        changes: [
          {
            type: 'update',
            productId: 'product-1',
            newPrice: 150,
            details: {
              price: 150,
              category: 'Electronics',
            },
          },
        ],
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results.updated).toBe(1);
    expect(productUpdates[0]).toMatchObject({
      category: 'Electronics',
      price: 150,
    });
    expect(productUpdates[0]).not.toHaveProperty('name');
  });

  it('returns 400 when a new imported product omits a name', async () => {
    const { POST } = await import('./route');

    const res = await POST(
      makeRequest({
        changes: [
          {
            type: 'new',
            details: {
              price: 200,
            },
          },
        ],
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid changes data');
    expect(productInserts).toEqual([]);
    expect(mockRevalidateProducts).not.toHaveBeenCalled();
  });

  it('returns 400 when a new imported product has a blank name', async () => {
    const { POST } = await import('./route');

    const res = await POST(
      makeRequest({
        changes: [
          {
            type: 'new',
            details: {
              name: '   ',
              price: 200,
            },
          },
        ],
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('Invalid changes data');
    expect(productInserts).toEqual([]);
    expect(mockRevalidateProducts).not.toHaveBeenCalled();
  });

  it('skips update changes without a safe product selector', async () => {
    const { POST } = await import('./route');

    const res = await POST(
      makeRequest({
        changes: [
          {
            type: 'update',
            productId: '   ',
            details: {
              name: '   ',
              price: 150,
              sku: '   ',
            },
          },
        ],
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results.updated).toBe(0);
    expect(json.results.errors).toContain(
      'Skipped update without a product id, SKU, or product name.'
    );
    expect(productUpdates).toEqual([]);
  });

  it('clears product cost price when update details explicitly set null', async () => {
    const { POST } = await import('./route');

    const res = await POST(
      makeRequest({
        changes: [
          {
            type: 'update',
            productId: 'product-1',
            newPrice: 150,
            details: {
              name: 'Updated Product',
              price: 150,
              cost_price: null,
              cost_price_was_edited: true,
            },
          },
        ],
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results.updated).toBe(1);
    expect(productUpdates[0]).toMatchObject({
      cost_price: null,
      name: 'Updated Product',
      price: 150,
    });
  });

  it('does not clear product cost price from AI-null details without an explicit edit marker', async () => {
    const { POST } = await import('./route');

    const res = await POST(
      makeRequest({
        changes: [
          {
            type: 'update',
            productId: 'product-1',
            newPrice: 150,
            details: {
              name: 'Updated Product',
              price: 150,
              cost_price: null,
            },
          },
        ],
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results.updated).toBe(1);
    expect(productUpdates[0]).toMatchObject({
      name: 'Updated Product',
      price: 150,
    });
    expect(productUpdates[0]).not.toHaveProperty('cost_price');
  });

  it('processes new product changes', async () => {
    const { POST } = await import('./route');

    const changes = [
      {
        type: 'new',
        details: {
          name: 'New Product',
          price: 200,
          cost_price: 120,
          stock: 10,
        },
      },
    ];

    const res = await POST(makeRequest({ changes }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results.created).toBe(1);
    expect(productInserts[0]).toMatchObject({
      cost_price: 120,
      price: 200,
      schema_markup: {
        offers: expect.objectContaining({
          priceCurrency: 'NGN',
        }),
      },
    });
    expect(mockRevalidateProducts).toHaveBeenCalledWith(MERCHANT_ID);
  });

  it('persists zero cost price on new products', async () => {
    const { POST } = await import('./route');

    const res = await POST(
      makeRequest({
        changes: [
          {
            type: 'new',
            details: {
              name: 'Zero Cost Product',
              price: 200,
              cost_price: 0,
            },
          },
        ],
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results.created).toBe(1);
    expect(productInserts[0]).toMatchObject({
      cost_price: 0,
      name: 'Zero Cost Product',
      price: 200,
    });
  });

  it('uses payout currency for imported product schema when country is missing', async () => {
    const { POST } = await import('./route');
    merchant = {
      id: MERCHANT_ID,
      business_name: 'Test Store',
      country: null,
      payout_currency: 'NGN',
    };

    const res = await POST(
      makeRequest({
        changes: [
          {
            type: 'new',
            details: { name: 'New Product', price: 200 },
          },
        ],
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results.created).toBe(1);
    expect(productInserts[0]).toMatchObject({
      schema_markup: {
        offers: expect.objectContaining({
          priceCurrency: 'NGN',
        }),
      },
    });
  });

  it('processes remove changes', async () => {
    const { POST } = await import('./route');

    const changes = [
      {
        type: 'remove',
        productId: 'product-1',
        details: { name: 'Old Product', price: 100 },
      },
    ];

    const res = await POST(makeRequest({ changes }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results.removed).toBe(1);
  });

  it('handles update errors gracefully', async () => {
    const { POST } = await import('./route');
    updateError = { message: 'Constraint violation' };

    const changes = [
      {
        type: 'update',
        productId: 'p-1',
        details: { name: 'Bad Update', price: 100 },
      },
    ];

    const res = await POST(makeRequest({ changes }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.results.errors).toHaveLength(1);
    expect(json.results.errors[0]).toContain('Bad Update');
  });

  it('calls revalidateProducts even with empty changes', async () => {
    const { POST } = await import('./route');

    const res = await POST(makeRequest({ changes: [] }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // Still called since the function always revalidates after processing
    expect(mockRevalidateProducts).toHaveBeenCalledWith(MERCHANT_ID);
  });
});
