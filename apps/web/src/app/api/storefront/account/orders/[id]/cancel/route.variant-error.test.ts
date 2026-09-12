import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  csrf: vi.fn(),
  email: vi.fn(),
  rateLimit: vi.fn(),
  revalidateProducts: vi.fn(),
  revalidateProductSlugs: vi.fn(),
  schedule: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.authenticate,
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/order-cancellation-email', () => ({
  sendOrderCancellationEmail: mocks.email,
}));
vi.mock('@/lib/product-cache-revalidation', () => ({
  productCacheRevalidation: {
    revalidateProducts: mocks.revalidateProducts,
    revalidateProductSlugs: mocks.revalidateProductSlugs,
  },
}));
vi.mock('@/lib/rate-limiter', () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock('@/lib/schedule-order-product-blog-purge-after-response', () => ({
  scheduleOrderProductBlogPurgeAfterResponse: mocks.schedule,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { POST } from './route';

const ORDER_ID = '00000000-0000-4000-8000-000000000abc';

function makeRequest() {
  return new NextRequest(
    `http://localhost:3000/api/storefront/account/orders/${ORDER_ID}/cancel`,
    { method: 'POST', body: JSON.stringify({ reason: 'Changed my mind' }) }
  );
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
      if (table === 'orders') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  merchant_id: 'merchant-1',
                  order_items: [
                    { product_id: 'product-1', variant_id: 'variant-1' },
                    { product_id: 'product-2', variant_id: 'variant-2' },
                  ],
                },
                error: null,
              }),
            })),
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
    rpc: mocks.rpc,
  };
  return { productIn, supabase, variantIn };
}

describe('customer cancellation variant policy fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.csrf.mockResolvedValue({ valid: true, response: null });
    mocks.rateLimit.mockResolvedValue(true);
    mocks.email.mockResolvedValue({ success: true });
    mocks.rpc.mockResolvedValue({ data: true, error: null });
  });

  it('fails open and purges every candidate when the variant policy lookup fails', async () => {
    // Arrange
    const { productIn, supabase, variantIn } = createSupabase();
    mocks.authenticate.mockResolvedValue({
      user: { id: 'customer-1' },
      error: null,
      supabase,
    });

    // Act
    const response = await POST(makeRequest(), {
      params: Promise.resolve({ id: ORDER_ID }),
    });

    // Assert
    expect(response.status).toBe(200);
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
