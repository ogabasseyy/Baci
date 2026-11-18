import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- Mocks ----

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
}));

const mockRevalidateProducts = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
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

const mockGenerateProductSlug = vi.hoisted(() =>
  vi.fn((name: string) => name.toLowerCase().replace(/\s+/g, '-'))
);

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
    merchantSlug: 'test-store',
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

vi.mock('@/lib/seo-utils', () => ({
  generateProductSlug: (name: string) =>
    mockGenerateProductSlug(name) as string,
  getProductUrl: (product: {
    slug?: string | null;
    category?: string | null;
  }) => {
    const slug = product.slug ?? '';
    const category = product.category?.toLowerCase().replace(/\s+/g, '-');
    return category ? `/${category}/${slug}` : `/products/${slug}`;
  },
}));

// Supabase mock
const MERCHANT_ID = 'merchant-123';
const USER_ID = 'user-123';

let authUser: { id: string } | null = { id: USER_ID };
let merchant: { id: string } | null = { id: MERCHANT_ID };
let insertError: unknown = null;

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
                  error: null,
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
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn(() =>
                Promise.resolve({
                  data: insertError ? null : { id: 'created-product-1' },
                  error: insertError,
                })
              ),
            })),
          })),
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

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(() =>
    Promise.resolve({ valid: true, response: null })
  ),
}));

// ---- Helpers ----

/** Create a mock file-like object with a text() method */
function createMockFile(content: string) {
  return {
    text: () => Promise.resolve(content),
    name: 'products.csv',
    type: 'text/csv',
    size: content.length,
  };
}

/** Create a NextRequest with a mock formData method that returns the given file */
function makeImportRequest(csvContent?: string): NextRequest {
  const req = new NextRequest(
    'http://localhost:3000/api/products/bulk-import',
    {
      method: 'POST',
    }
  );

  const mockFile = csvContent !== undefined ? createMockFile(csvContent) : null;

  vi.spyOn(req, 'formData').mockResolvedValue({
    get: (key: string) => (key === 'file' ? mockFile : null),
    getAll: () => [],
    has: (key: string) => key === 'file' && mockFile !== null,
    entries: () => new Map().entries(),
    keys: () => new Map().keys(),
    values: () => new Map().values(),
    forEach: () => {
      /* noop mock */
    },
    append: () => {
      /* noop mock */
    },
    delete: () => {
      /* noop mock */
    },
    set: () => {
      /* noop mock */
    },
    [Symbol.iterator]: () => new Map().entries(),
  } as unknown as FormData);

  return req;
}

// ---- Tests ----

describe('POST /api/products/bulk-import', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authUser = { id: USER_ID };
    merchant = { id: MERCHANT_ID };
    merchantContextMock.current = {
      merchantId: MERCHANT_ID,
      merchantSlug: 'test-store',
      businessName: 'Test Store',
      staffAccess: {
        isOwner: true,
        isStaff: false,
        role: null,
        permissions: { full_access: { all: true } },
      },
    };
    insertError = null;
    mockGenerateProductSlug.mockImplementation((name: string) =>
      name.toLowerCase().replace(/\s+/g, '-')
    );
  });

  it('returns 401 when not authenticated', async () => {
    const { POST } = await import('./route');
    authUser = null;

    const res = await POST(makeImportRequest('name,price\nTest,100'));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 404 when merchant not found', async () => {
    const { POST } = await import('./route');
    merchantContextMock.current = null;

    const res = await POST(makeImportRequest('name,price\nTest,100'));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Merchant not found');
  });

  it('returns 400 when no file provided', async () => {
    const { POST } = await import('./route');

    const res = await POST(makeImportRequest());
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('No file provided');
  });

  it('returns 400 for empty CSV', async () => {
    const { POST } = await import('./route');

    const res = await POST(makeImportRequest('name,price'));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe('No valid rows found in CSV');
  });

  it('imports valid products and calls revalidateProducts', async () => {
    const { POST } = await import('./route');

    const csv =
      'name,price,description\nProduct A,100,A desc\nProduct B,200,B desc';
    const res = await POST(makeImportRequest(csv));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(2);
    expect(json.failed).toBe(0);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(MERCHANT_ID);
  });

  it('purges only the successful public rows after a partially successful import', async () => {
    const { POST } = await import('./route');

    const csv =
      'name,price,category,status\nProduct A,100,Electronics,active\nDraft Item,50,Books,draft\nInvalid Item,-5,Electronics,active';
    const res = await POST(makeImportRequest(csv));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: 2, failed: 1 });
    expect(mockRevalidateProducts).toHaveBeenCalledWith(MERCHANT_ID);
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
      MERCHANT_ID,
      ['product-a'],
      { expireImmediately: true }
    );
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      [{ slug: 'product-a', categorySegment: 'electronics' }]
    );
    expect(mockRevalidateProductSlugs.mock.invocationCallOrder[0]).toBeLessThan(
      mockScheduleStorefrontProductPurge.mock.invocationCallOrder[0]
    );
  });

  it('does not schedule a public purge for draft-only imports', async () => {
    const { POST } = await import('./route');

    const res = await POST(
      makeImportRequest('name,price,category,status\nDraft Item,50,Books,draft')
    );

    expect(res.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(MERCHANT_ID);
    expect(mockRevalidateProductSlugs).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
  });

  it('uses the persisted product id when an active import has a blank slug', async () => {
    const { POST } = await import('./route');
    mockGenerateProductSlug.mockReturnValueOnce('');

    const response = await POST(
      makeImportRequest('name,price\nEmoji Product,50')
    );

    expect(response.status).toBe(200);
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith(
      MERCHANT_ID,
      ['created-product-1'],
      { expireImmediately: true }
    );
    expect(mockScheduleStorefrontProductPurge).toHaveBeenCalledWith(
      'test-store',
      [{ slug: 'created-product-1', categorySegment: null }]
    );
  });

  it('does not call revalidateProducts when all rows fail', async () => {
    const { POST } = await import('./route');

    const csv = 'name,price\n,100\nBad,-5';
    const res = await POST(makeImportRequest(csv));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(0);
    expect(json.failed).toBe(2);
    expect(mockRevalidateProducts).not.toHaveBeenCalled();
  });

  it('reports per-row errors for invalid data', async () => {
    const { POST } = await import('./route');

    const csv =
      'name,price,stock_quantity\nGood,50,10\nBad,abc,5\nAlsoBad,100,-3';
    const res = await POST(makeImportRequest(csv));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(1);
    expect(json.failed).toBe(2);
    expect(json.errors).toHaveLength(2);
    expect(json.errors[0]).toContain('Row 3');
    expect(json.errors[1]).toContain('Row 4');
  });

  it('handles DB insert errors gracefully', async () => {
    const { POST } = await import('./route');
    insertError = { message: 'Duplicate SKU' };

    const csv = 'name,price\nProduct,100';
    const res = await POST(makeImportRequest(csv));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(0);
    expect(json.failed).toBe(1);
    expect(json.errors[0]).toContain('Duplicate SKU');
  });
});
