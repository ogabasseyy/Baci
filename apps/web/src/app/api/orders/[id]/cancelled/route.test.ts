import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  checkCsrfProtection: vi.fn(),
  getMerchantIdForApiUser: vi.fn(),
  revalidateDashboard: vi.fn(),
  revalidateProductSlugs: vi.fn(),
  revalidateProducts: vi.fn(),
  scheduleOrderProductBlogPurgeAfterResponse: vi
    .fn()
    .mockResolvedValue(undefined),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.authenticateApiRequest,
  getMerchantIdForApiUser: mocks.getMerchantIdForApiUser,
}));
vi.mock('@/lib/product-cache-revalidation', () => ({
  productCacheRevalidation: {
    revalidateDashboard: mocks.revalidateDashboard,
    revalidateProductSlugs: mocks.revalidateProductSlugs,
    revalidateProducts: mocks.revalidateProducts,
  },
}));
vi.mock('@/lib/schedule-order-product-blog-purge-after-response', () => ({
  scheduleOrderProductBlogPurgeAfterResponse:
    mocks.scheduleOrderProductBlogPurgeAfterResponse,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));

import { POST } from './route';

function request(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

function createSupabase() {
  const orderItemsEq = vi.fn().mockResolvedValue({
    data: [{ product_id: 'product-1' }],
    error: null,
  });
  const variantsIn = vi.fn().mockResolvedValue({ data: [], error: null });
  const productsIn = vi.fn().mockResolvedValue({
    data: [{ id: 'product-1', manage_stock: true, slug: 'phone' }],
    error: null,
  });
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'order_items') {
        return { select: vi.fn(() => ({ eq: orderItemsEq })) };
      }
      if (table === 'products') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ in: productsIn })),
          })),
        };
      }
      if (table === 'product_variants') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ in: variantsIn })),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
  };
  return { orderItemsEq, productsIn, supabase, variantsIn };
}

describe('POST /api/orders/[id]/cancelled', () => {
  it('keeps product invalidation after a committed restock and failed product read', async () => {
    const { supabase, productsIn } = createSupabase();
    productsIn.mockResolvedValueOnce({
      data: [],
      error: { message: 'read failed' },
    } as never);
    mocks.authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase,
      user: { id: 'user-1' },
    });
    const response = await POST(
      request({ cancelled_by: 'merchant', confirm_cancellation: true }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );
    expect(response.status).toBe(202);
    expect(
      mocks.scheduleOrderProductBlogPurgeAfterResponse
    ).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      productIds: ['product-1'],
      supabase,
    });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkCsrfProtection.mockResolvedValue({ valid: true });
    mocks.getMerchantIdForApiUser.mockResolvedValue('merchant-1');
  });

  it('authenticates before validating the cancellation confirmation', async () => {
    const { supabase } = createSupabase();
    mocks.authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase,
      user: { id: 'user-1' },
    });

    const response = await POST(request({ cancelled_by: 'merchant' }), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_REQUEST_BODY',
    });
    expect(mocks.authenticateApiRequest).toHaveBeenCalledOnce();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('queues trusted side effects and revalidates listing, feed, and PDP caches', async () => {
    const { supabase } = createSupabase();
    mocks.authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase,
      user: { id: 'user-1' },
    });

    const response = await POST(
      request({
        cancelled_by: 'merchant',
        confirm_cancellation: true,
        reason: 'Customer requested cancellation',
      }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(202);
    expect(mocks.revalidateDashboard).toHaveBeenCalledWith('merchant-1');
    expect(supabase.rpc).toHaveBeenCalledWith('cancel_order_as_merchant', {
      p_order_id: 'order-1',
      p_reason: 'Customer requested cancellation',
    });
    expect(mocks.revalidateProducts).toHaveBeenCalledWith(
      'merchant-1',
      undefined,
      { feedScope: 'merchant' }
    );
    expect(mocks.revalidateProductSlugs).toHaveBeenCalledWith('merchant-1', [
      'phone',
    ]);
    expect(
      mocks.scheduleOrderProductBlogPurgeAfterResponse
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        productIds: ['product-1'],
        supabase,
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      message: 'Cancellation completed; side effects are queued',
      sideEffects: { customerEmail: 'queued', refund: 'queued_if_required' },
    });
  });

  it('does not queue or revalidate when the order is no longer cancellable', async () => {
    const { supabase } = createSupabase();
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'order_not_cancellable' },
    });
    mocks.authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase,
      user: { id: 'user-1' },
    });

    const response = await POST(request({ confirm_cancellation: true }), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(409);
    expect(mocks.revalidateProducts).not.toHaveBeenCalled();
  });

  it('keeps an idempotent retry queued without using the new request reason', async () => {
    const { supabase } = createSupabase();
    supabase.rpc.mockResolvedValue({ data: false, error: null });
    mocks.authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase,
      user: { id: 'user-1' },
    });

    const response = await POST(
      request({ confirm_cancellation: true, reason: 'Different retry reason' }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      alreadyCancelled: true,
      success: true,
    });
  });
  it('avoids product and feed cache churn for unlimited-inventory items', async () => {
    const { productsIn, supabase } = createSupabase();
    productsIn.mockResolvedValue({
      data: [{ manage_stock: false, slug: 'service-plan' }],
      error: null,
    });
    mocks.authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase,
      user: { id: 'user-1' },
    });

    const response = await POST(request({ confirm_cancellation: true }), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(202);
    expect(mocks.revalidateDashboard).toHaveBeenCalledWith('merchant-1');
    expect(mocks.revalidateProducts).not.toHaveBeenCalled();
    expect(mocks.revalidateProductSlugs).not.toHaveBeenCalled();
  });
});
