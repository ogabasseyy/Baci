import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  merchant: vi.fn(),
  expire: vi.fn(),
  revalidateProducts: vi.fn(),
  revalidateSlugs: vi.fn(),
  schedule: vi.fn(),
  scheduleAfter: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  hasPermission: vi.fn(() => true),
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/expire-product-blog-cache', () => ({
  expireProductBlogCache: mocks.expire,
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: mocks.revalidateProducts,
  revalidateProductSlugs: mocks.revalidateSlugs,
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mocks.merchant,
  toUserAccess: vi.fn(() => ({
    isOwner: true,
    isStaff: false,
    permissions: { full_access: { all: true } },
    role: 'owner',
  })),
}));
vi.mock('@/lib/schedule-product-blog-purge-after-response', () => ({
  scheduleProductBlogPurgeAfterResponse: mocks.scheduleAfter,
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: mocks.schedule,
}));
vi.mock('@/lib/seo-utils', () => ({
  generateProductSlug: (name: string) =>
    name.toLowerCase().replace(/\s+/gu, '-'),
  getProductUrl: (product: { slug?: string; category?: string | null }) =>
    product.category
      ? `/${product.category.toLowerCase()}/${product.slug}`
      : `/products/${product.slug}`,
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: vi.fn() }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mocks.auth()),
}));

import { POST } from './route';

function makeRequest(csv: string) {
  const request = new NextRequest(
    'https://app.example/api/products/bulk-import',
    {
      method: 'POST',
    }
  );
  const file = {
    name: 'products.csv',
    text: () => Promise.resolve(csv),
    type: 'text/csv',
    size: csv.length,
  };
  vi.spyOn(request, 'formData').mockResolvedValue({
    get: (key: string) => (key === 'file' ? file : null),
  } as unknown as FormData);
  return request;
}

function createSupabase() {
  let insertIndex = 0;
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
    from: vi.fn((table: string) => {
      if (table !== 'products') throw new Error(`Unexpected table ${table}`);
      return {
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: `00000000-0000-4000-8000-${String(++insertIndex).padStart(12, '0')}`,
              },
              error: null,
            }),
          })),
        })),
      };
    }),
  };
}

describe('bulk import purge ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.csrf.mockResolvedValue({ valid: true, response: null });
    mocks.merchant.mockResolvedValue({
      merchantId: 'merchant-1',
      merchantSlug: 'test-store',
      businessName: 'Test Store',
      staffAccess: {
        isOwner: true,
        isStaff: false,
        role: null,
        permissions: {},
      },
    });
  });

  it('expires related-blog data before a high-cardinality public purge', async () => {
    const supabase = createSupabase();
    mocks.auth.mockReturnValue(supabase);
    const rows = Array.from(
      { length: 51 },
      (_, index) => `Product ${index + 1},${index + 1},Electronics,active`
    );

    const response = await POST(
      makeRequest(`name,price,category,status\n${rows.join('\n')}`)
    );

    expect(response.status).toBe(200);
    expect(mocks.expire).toHaveBeenCalledWith('merchant-1');
    expect(mocks.schedule).toHaveBeenCalledOnce();
    expect(mocks.expire.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.schedule.mock.invocationCallOrder[0]
    );
    expect(mocks.scheduleAfter).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        productIds: expect.any(Array),
      })
    );
  });
});
