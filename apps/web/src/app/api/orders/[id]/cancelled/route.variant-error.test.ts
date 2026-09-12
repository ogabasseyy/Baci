import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getMerchantId: vi.fn(),
  revalidateDashboard: vi.fn(),
  revalidateProducts: vi.fn(),
  revalidateProductSlugs: vi.fn(),
  schedule: vi.fn(),
  csrf: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.authenticate,
  getMerchantIdForApiUser: mocks.getMerchantId,
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/product-cache-revalidation', () => ({
  productCacheRevalidation: {
    revalidateDashboard: mocks.revalidateDashboard,
    revalidateProducts: mocks.revalidateProducts,
    revalidateProductSlugs: mocks.revalidateProductSlugs,
  },
}));
vi.mock('@/lib/schedule-order-product-blog-purge-after-response', () => ({
  scheduleOrderProductBlogPurgeAfterResponse: mocks.schedule,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { POST } from './route';

function request(): NextRequest {
  return {
    json: vi.fn().mockResolvedValue({ confirm_cancellation: true }),
  } as unknown as NextRequest;
}

function createSupabase() {
  const variantIn = vi.fn().mockResolvedValue({
    data: null,
    error: { code: 'PGRST000', message: 'temporary variant read failure' },
  });
  const productIn = vi.fn().mockResolvedValue({
    data: [
      { id: 'product-1', slug: 'managed-phone', manage_stock: true },
      { id: 'product-2', slug: 'unlimited-phone', manage_stock: false },
    ],
    error: null,
  });
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'order_items') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
                { product_id: 'product-1', variant_id: 'variant-1' },
                { product_id: 'product-2', variant_id: 'variant-2' },
              ],
              error: null,
            }),
          })),
        };
      }
      if (table === 'product_variants') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ in: variantIn })),
          })),
        };
      }
      if (table === 'products') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ in: productIn })),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
  };
  return { productIn, supabase, variantIn };
}

describe('merchant cancellation variant policy fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.csrf.mockResolvedValue({ valid: true, response: null });
    mocks.authenticate.mockResolvedValue({
      error: null,
      supabase: null,
      user: { id: 'user-1' },
    });
    mocks.getMerchantId.mockResolvedValue('merchant-1');
  });

  it('fails open and purges every candidate when the variant policy lookup fails', async () => {
    const { productIn, supabase, variantIn } = createSupabase();
    mocks.authenticate.mockResolvedValue({
      error: null,
      supabase,
      user: { id: 'user-1' },
    });

    const response = await POST(request(), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(202);
    expect(variantIn).toHaveBeenCalledWith('id', ['variant-2']);
    expect(productIn).toHaveBeenCalledWith('id', ['product-1', 'product-2']);
    expect(mocks.revalidateProductSlugs).toHaveBeenCalledWith('merchant-1', [
      'managed-phone',
      'unlimited-phone',
    ]);
    expect(mocks.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        productIds: ['product-1', 'product-2'],
        supabase,
      })
    );
  });
});
