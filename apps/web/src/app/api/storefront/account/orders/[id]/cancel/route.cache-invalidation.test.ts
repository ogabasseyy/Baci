import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateApiRequest = vi.fn();
const mockCheckCsrfProtection = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockRpc = vi.fn();
const mockRevalidateProducts = vi.fn();
const mockRevalidateProductSlugs = vi.fn();
const mockScheduleOrderProductBlogPurgeAfterResponse = vi.fn();
const mockSendOrderCancellationEmail = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));
vi.mock('@/lib/rate-limiter', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));
vi.mock('@/lib/product-cache-revalidation', () => ({
  productCacheRevalidation: {
    revalidateProducts: (...args: unknown[]) => mockRevalidateProducts(...args),
    revalidateProductSlugs: (...args: unknown[]) =>
      mockRevalidateProductSlugs(...args),
  },
}));
vi.mock('@/lib/schedule-order-product-blog-purge-after-response', () => ({
  scheduleOrderProductBlogPurgeAfterResponse: (...args: unknown[]) =>
    mockScheduleOrderProductBlogPurgeAfterResponse(...args),
}));
vi.mock('@/lib/order-cancellation-email', () => ({
  sendOrderCancellationEmail: (...args: unknown[]) =>
    mockSendOrderCancellationEmail(...args),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { POST } from './route';

const ORDER_ID = '00000000-0000-4000-8000-000000000abc';
const params = Promise.resolve({ id: ORDER_ID });

function makeRequest() {
  return new NextRequest(
    `http://localhost:3000/api/storefront/account/orders/${ORDER_ID}/cancel`,
    { method: 'POST', body: JSON.stringify({ reason: 'Changed my mind' }) }
  );
}

function createSupabase() {
  const orderEq = vi.fn().mockResolvedValue({
    data: {
      merchant_id: 'merchant-1',
      order_items: [
        { product_id: 'product-1' },
        { product_id: 'product-2' },
        { product_id: 'product-1' },
      ],
    },
    error: null,
  });
  const productIn = vi.fn().mockResolvedValue({
    data: [
      { id: 'product-1', slug: 'phone-one', manage_stock: true },
      { id: 'product-2', slug: 'phone-two', manage_stock: true },
    ],
    error: null,
  });
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ maybeSingle: orderEq })),
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
    rpc: mockRpc,
  };
  return supabase;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckCsrfProtection.mockResolvedValue({ valid: true, response: null });
  mockCheckRateLimit.mockResolvedValue(true);
  mockSendOrderCancellationEmail.mockResolvedValue({ success: true });
});

describe('customer cancellation cache invalidation', () => {
  it('purges product and linked article caches after a successful restock', async () => {
    const supabase = createSupabase();
    mockAuthenticateApiRequest.mockResolvedValue({
      user: { id: 'customer-1' },
      error: null,
      supabase,
    });
    mockRpc.mockResolvedValue({ data: true, error: null });

    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(200);
    expect(mockRevalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { feedScope: 'merchant' }
    );
    expect(mockRevalidateProductSlugs).toHaveBeenCalledWith('merchant-1', [
      'phone-one',
      'phone-two',
    ]);
    expect(mockScheduleOrderProductBlogPurgeAfterResponse).toHaveBeenCalledWith(
      {
        merchantId: 'merchant-1',
        productIds: ['product-1', 'product-2'],
        supabase,
      }
    );
  });

  it('still queues the article purge when product tag revalidation is unavailable', async () => {
    const supabase = createSupabase();
    mockAuthenticateApiRequest.mockResolvedValue({
      user: { id: 'customer-1' },
      error: null,
      supabase,
    });
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockRevalidateProducts.mockImplementation(() => {
      throw new Error('cache context unavailable');
    });

    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(200);
    expect(
      mockScheduleOrderProductBlogPurgeAfterResponse
    ).toHaveBeenCalledOnce();
  });

  it('skips cache and article purges for an unlimited-stock cancellation', async () => {
    const supabase = createSupabase();
    const productIn = vi.fn().mockResolvedValue({
      data: [
        { id: 'product-1', slug: 'phone-one', manage_stock: false },
        { id: 'product-2', slug: 'phone-two', manage_stock: false },
      ],
      error: null,
    });
    supabase.from = vi.fn((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  merchant_id: 'merchant-1',
                  order_items: [{ product_id: 'product-1' }],
                },
                error: null,
              }),
            })),
          })),
        };
      }
      if (table === 'products') {
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ in: productIn })) })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }) as typeof supabase.from;
    mockAuthenticateApiRequest.mockResolvedValue({
      user: { id: 'customer-1' },
      error: null,
      supabase,
    });
    mockRpc.mockResolvedValue({ data: true, error: null });

    const response = await POST(makeRequest(), { params });

    expect(response.status).toBe(200);
    expect(mockRevalidateProducts).not.toHaveBeenCalled();
    expect(mockRevalidateProductSlugs).not.toHaveBeenCalled();
    expect(
      mockScheduleOrderProductBlogPurgeAfterResponse
    ).not.toHaveBeenCalled();
  });
});
