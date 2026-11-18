import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const MERCHANT_ID = 'merchant-123';
const mockRevalidateProducts = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
const mockScheduleStorefrontProductPurge = vi.fn();
const mockGenerateProductSlug = vi.hoisted(() =>
  vi.fn((name: string) => name.toLowerCase().replace(/\s+/g, '-'))
);

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
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn().mockResolvedValue({
    merchantId: 'merchant-123',
    merchantSlug: 'test-store',
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
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: vi.fn() }),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi
    .fn()
    .mockResolvedValue({ valid: true, response: null }),
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
                data: { id: 'merchant-123' },
                error: null,
              }),
              single: vi.fn().mockResolvedValue({
                data: { id: 'merchant-123' },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'products') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'created-product-1' },
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

function makeImportRequest(csvContent: string): NextRequest {
  const req = new NextRequest(
    'http://localhost:3000/api/products/bulk-import',
    {
      method: 'POST',
    }
  );
  const mockFile = {
    text: () => Promise.resolve(csvContent),
    name: 'products.csv',
    type: 'text/csv',
    size: csvContent.length,
  };
  vi.spyOn(req, 'formData').mockResolvedValue({
    get: (key: string) => (key === 'file' ? mockFile : null),
  } as unknown as FormData);
  return req;
}

describe('POST /api/products/bulk-import storefront purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRevalidateProducts.mockReturnValue(true);
    mockRevalidateProductSlugs.mockReturnValue(true);
    mockGenerateProductSlug.mockImplementation((name: string) =>
      name.toLowerCase().replace(/\s+/g, '-')
    );
  });

  it('purges only the successful public rows after a partially successful import', async () => {
    const csv =
      'name,price,category,status\nProduct A,100,Electronics,active\nDraft Item,50,Books,draft\nInvalid Item,-5,Electronics,active';
    const res = await POST(makeImportRequest(csv));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({ success: 2, failed: 1 });
    expect(mockRevalidateProducts).not.toHaveBeenCalledWith(MERCHANT_ID);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      MERCHANT_ID,
      undefined,
      { expireImmediately: true, omitMerchantWidePdpDetails: true }
    );
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
    const res = await POST(
      makeImportRequest('name,price,category,status\nDraft Item,50,Books,draft')
    );

    expect(res.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(MERCHANT_ID);
    expect(mockRevalidateProductSlugs).not.toHaveBeenCalled();
    expect(mockScheduleStorefrontProductPurge).not.toHaveBeenCalled();
  });

  it('uses the persisted product id when an active import has a blank slug', async () => {
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
});
