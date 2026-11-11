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
import { createSupabase, request } from './route.test-support';

describe('POST /api/orders/[id]/cancelled refund mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkCsrfProtection.mockResolvedValue({ valid: true });
    mocks.getMerchantIdForApiUser.mockResolvedValue('merchant-1');
  });

  it('passes a cancel-only choice to the RPC and reports a manual refund', async () => {
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
        refund: 'manual',
      }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(202);
    expect(supabase.rpc).toHaveBeenCalledWith(
      'cancel_order_as_merchant',
      expect.objectContaining({ p_refund_mode: 'manual' })
    );
    await expect(response.json()).resolves.toMatchObject({
      sideEffects: { customerEmail: 'queued', refund: 'manual_required' },
    });
  });

  it('sends the automatic mode to the RPC when the refund field is omitted', async () => {
    const { supabase } = createSupabase();
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
    expect(supabase.rpc).toHaveBeenCalledWith(
      'cancel_order_as_merchant',
      expect.objectContaining({ p_refund_mode: 'automatic' })
    );
  });

  it('rejects an unknown refund choice before touching the database', async () => {
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
        refund: 'skip',
      }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('explains a cancel-only refusal for staff without refund permission', async () => {
    const { supabase } = createSupabase();
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'order_cancel_refund_forbidden' },
    });
    mocks.authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase,
      user: { id: 'user-1' },
    });

    const response = await POST(
      request({ confirm_cancellation: true, refund: 'manual' }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CANCEL_REFUND_FORBIDDEN',
      error: expect.stringContaining('refund permission'),
    });
  });

  it('reports an unknown refund outcome when the persisted mode cannot be read', async () => {
    const { persistedMode, supabase } = createSupabase();
    persistedMode.mockResolvedValue({
      data: null,
      error: { message: 'read failed' },
    });
    supabase.rpc.mockResolvedValue({ data: false, error: null });
    mocks.authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase,
      user: { id: 'user-1' },
    });

    const response = await POST(
      request({ confirm_cancellation: true, refund: 'manual' }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    await expect(response.json()).resolves.toMatchObject({
      alreadyCancelled: true,
      sideEffects: { refund: 'unknown' },
    });
  });

  it('reports authoritative in-flight and remaining amounts for a cancel-only order', async () => {
    const { ledgerRows, supabase } = createSupabase();
    ledgerRows.mockResolvedValue({
      data: [
        {
          amount: 3000,
          currency: 'NGN',
          gateway: 'paystack',
          gateway_reference: 'ref-1',
          id: 'leg-1',
          payment_transaction_id: null,
          status: 'completed',
          transaction_type: 'payment',
        },
        {
          amount: 2000,
          currency: 'NGN',
          gateway: 'paystack',
          gateway_reference: 'ref-2',
          id: 'leg-2',
          payment_transaction_id: null,
          status: 'refund_pending',
          transaction_type: 'payment',
        },
      ],
      error: null,
    });
    mocks.authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase,
      user: { id: 'user-1' },
    });

    const response = await POST(
      request({ confirm_cancellation: true, refund: 'manual' }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    await expect(response.json()).resolves.toMatchObject({
      sideEffects: {
        refund: 'manual_required',
        refundDetails: {
          currency: 'NGN',
          inFlightAmount: 2000,
          remainingAmount: 3000,
        },
      },
    });
  });

  it('reports an unknown outcome when the ledger cannot be read', async () => {
    const { ledgerRows, supabase } = createSupabase();
    ledgerRows.mockResolvedValue({ data: null, error: { message: 'down' } });
    mocks.authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase,
      user: { id: 'user-1' },
    });

    const response = await POST(
      request({ confirm_cancellation: true, refund: 'manual' }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    await expect(response.json()).resolves.toMatchObject({
      sideEffects: { refund: 'unknown' },
    });
  });

  it('maps an invalid refund mode raised by the RPC to 400', async () => {
    const { supabase } = createSupabase();
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'invalid_refund_mode' },
    });
    mocks.authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase,
      user: { id: 'user-1' },
    });

    const response = await POST(request({ confirm_cancellation: true }), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.revalidateProducts).not.toHaveBeenCalled();
  });

  it('reports the persisted refund mode on a replay instead of echoing the request', async () => {
    const { persistedMode, supabase } = createSupabase();
    supabase.rpc.mockResolvedValue({ data: false, error: null });
    mocks.authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase,
      user: { id: 'user-1' },
    });

    const response = await POST(
      request({ confirm_cancellation: true, refund: 'manual' }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(persistedMode).toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      alreadyCancelled: true,
      sideEffects: { refund: 'queued_if_required' },
    });
  });
});
