import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineArchiveRouteAuthorizationSuite } from './archive-route-authorization.test-suite';
import { defineArchiveRoutePurgeSuite } from './archive-route-purge.test-suite';
import { defineArchiveRouteValidationSuite } from './archive-route-validation.test-suite';

const MERCHANT_ONE_ID = '11111111-1111-4111-8111-111111111111';
const MERCHANT_TWO_ID = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  archiveError: null as { code?: string; message?: string } | null,
  archiveResult: {
    id: '123e4567-e89b-42d3-a456-426614174000',
    slug: 'phone-ultra',
    status: 'archived',
    name: 'Phone Ultra',
    category: 'Smartphones',
    categories: null as unknown,
    product_categories: null as unknown,
  } as {
    id: string;
    slug: string | null;
    status: string;
    name: string | null;
    category: string | null;
    categories: unknown;
    product_categories: unknown;
  } | null,
  authenticateApiRequest: vi.fn(),
  checkCsrfProtection: vi.fn(),
  filters: [] as [string, unknown][],
  getMerchantForApiRequest: vi.fn(),
  hasPermission: vi.fn(),
  merchantError: null as { message?: string } | null,
  merchantSlugRow: { slug: 'test-store' } as { slug: string | null } | null,
  merchantThrows: false,
  revalidateProducts: vi.fn(),
  revalidateProductSlugs: vi.fn(),
  scheduleProductBlogPurgeAfterResponse: vi.fn(),
  scheduleStorefrontProductPurge: vi.fn(),
  selectArgs: [] as string[],
  supabase: null as unknown,
  updatePayload: null as unknown,
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.authenticateApiRequest,
  hasPermission: mocks.hasPermission,
}));
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateProducts: mocks.revalidateProducts,
  revalidateProductSlugs: mocks.revalidateProductSlugs,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mocks.getMerchantForApiRequest,
  toUserAccess: (context: {
    merchantId: string;
    staffAccess: {
      isOwner: boolean;
      isStaff: boolean;
      permissions: Record<string, Record<string, boolean>>;
      role: string | null;
    };
  }) => ({
    merchantId: context.merchantId,
    isOwner: context.staffAccess.isOwner,
    isStaff: context.staffAccess.isStaff,
    permissions: context.staffAccess.permissions,
    role: context.staffAccess.role ?? 'owner',
  }),
}));
vi.mock('@/lib/storefront-product-purge', () => ({
  scheduleStorefrontProductPurge: (...args: unknown[]) =>
    mocks.scheduleStorefrontProductPurge(...args),
}));
vi.mock('@/lib/schedule-product-blog-purge-after-response', () => ({
  scheduleProductBlogPurgeAfterResponse: (...args: unknown[]) =>
    mocks.scheduleProductBlogPurgeAfterResponse(...args),
}));
vi.mock('@/lib/storefront-product-purge-urls', () => ({
  resolveProductPurgeCategorySegmentForRow: (row: {
    category?: string | null;
    categories?: { slug?: string } | null;
    product_categories?: Array<{ categories?: { slug?: string } }> | null;
  }) => {
    const direct = row.categories?.slug;
    if (direct) return direct;
    const text = row.category?.trim();
    if (text) return text.toLowerCase().replace(/\s+/g, '-');
    return row.product_categories?.[0]?.categories?.slug ?? null;
  },
}));

function createSupabase() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'merchants') {
        const merchantQuery = {
          select: vi.fn(() => merchantQuery),
          eq: vi.fn(() => merchantQuery),
          single: vi.fn(() => {
            if (mocks.merchantThrows) {
              return Promise.reject(new Error('merchant read failed'));
            }
            return Promise.resolve({
              data: mocks.merchantError ? null : mocks.merchantSlugRow,
              error: mocks.merchantError,
            });
          }),
        };
        return merchantQuery;
      }

      expect(table).toBe('products');
      const query = {
        eq: vi.fn((column: string, value: unknown) => {
          mocks.filters.push([column, value]);
          return query;
        }),
        select: vi.fn((arg?: string) => {
          if (typeof arg === 'string') mocks.selectArgs.push(arg);
          return {
            single: vi.fn(() =>
              Promise.resolve({
                data: mocks.archiveError ? null : mocks.archiveResult,
                error: mocks.archiveError,
              })
            ),
          };
        }),
      };
      return {
        update: vi.fn((payload: unknown) => {
          mocks.updatePayload = payload;
          return query;
        }),
      };
    }),
  };
}

import { PATCH } from './route';

function makeRequest(body: unknown = { merchantId: MERCHANT_ONE_ID }) {
  return new NextRequest(
    'https://usebaci.com/api/products/123e4567-e89b-42d3-a456-426614174000/archive',
    { method: 'PATCH', body: JSON.stringify(body) }
  );
}

function makeMalformedRequest() {
  return new NextRequest(
    'https://usebaci.com/api/products/123e4567-e89b-42d3-a456-426614174000/archive',
    { method: 'PATCH', body: '{' }
  );
}

function makeContext(id = '123e4567-e89b-42d3-a456-426614174000') {
  return { params: Promise.resolve({ id }) };
}

describe('PATCH /api/products/[id]/archive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.archiveError = null;
    mocks.archiveResult = {
      id: '123e4567-e89b-42d3-a456-426614174000',
      slug: 'phone-ultra',
      status: 'archived',
      name: 'Phone Ultra',
      category: 'Smartphones',
      categories: null,
      product_categories: null,
    };
    mocks.filters.length = 0;
    mocks.merchantError = null;
    mocks.merchantSlugRow = { slug: 'test-store' };
    mocks.merchantThrows = false;
    mocks.selectArgs.length = 0;
    mocks.supabase = createSupabase();
    mocks.updatePayload = null;
    mocks.authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase: mocks.supabase,
      user: { id: 'user-1' },
    });
    mocks.checkCsrfProtection.mockResolvedValue({ valid: true });
    mocks.getMerchantForApiRequest.mockResolvedValue({
      merchantId: MERCHANT_ONE_ID,
      staffAccess: {
        isOwner: false,
        isStaff: true,
        permissions: { products: { edit: true } },
        role: 'manager',
      },
    });
    mocks.hasPermission.mockReturnValue(true);
  });

  it('archives a merchant product when the user has edit permission', async () => {
    const response = await PATCH(makeRequest(), makeContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      product: { id: '123e4567-e89b-42d3-a456-426614174000' },
      success: true,
    });
    expect(mocks.hasPermission).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: MERCHANT_ONE_ID }),
      'products',
      'edit'
    );
    expect(mocks.updatePayload).toMatchObject({ status: 'archived' });
    expect(mocks.filters).toContainEqual([
      'id',
      '123e4567-e89b-42d3-a456-426614174000',
    ]);
    expect(mocks.filters).toContainEqual(['merchant_id', MERCHANT_ONE_ID]);
    expect(mocks.revalidateProducts).toHaveBeenCalledWith(
      MERCHANT_ONE_ID,
      'phone-ultra'
    );
  });

  it('archives the merchant asserted by the request after authorizing access to it', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValueOnce({
      merchantId: MERCHANT_TWO_ID,
      staffAccess: {
        isOwner: false,
        isStaff: true,
        permissions: { products: { edit: true } },
        role: 'manager',
      },
    });

    const response = await PATCH(
      makeRequest({ merchantId: MERCHANT_TWO_ID }),
      makeContext()
    );

    expect(response.status).toBe(200);
    expect(mocks.getMerchantForApiRequest).toHaveBeenCalledWith(
      mocks.supabase,
      'user-1',
      { requestedMerchantId: MERCHANT_TWO_ID }
    );
    expect(mocks.filters).toContainEqual(['merchant_id', MERCHANT_TWO_ID]);
    expect(mocks.revalidateProducts).toHaveBeenCalledWith(
      MERCHANT_TWO_ID,
      'phone-ultra'
    );
  });

  it('does not leak the category join/junction embeds in the response body', async () => {
    mocks.archiveResult = {
      id: '123e4567-e89b-42d3-a456-426614174000',
      slug: 'phone-ultra',
      status: 'archived',
      name: 'Phone Ultra',
      category: 'Smartphones',
      categories: { slug: 'smartphones' },
      product_categories: [{ categories: { slug: 'gadgets' } }],
    };

    const response = await PATCH(makeRequest(), makeContext());

    await expect(response.json()).resolves.toEqual({
      product: {
        id: '123e4567-e89b-42d3-a456-426614174000',
        slug: 'phone-ultra',
        status: 'archived',
      },
      success: true,
    });
  });

  defineArchiveRouteAuthorizationSuite({
    PATCH,
    makeContext,
    makeRequest,
    mocks,
  });
  defineArchiveRouteValidationSuite({
    PATCH,
    makeContext,
    makeMalformedRequest,
    makeRequest,
    mocks,
  });
  defineArchiveRoutePurgeSuite({
    PATCH,
    makeContext,
    makeRequest,
    mocks,
    merchantId: MERCHANT_ONE_ID,
  });
});
