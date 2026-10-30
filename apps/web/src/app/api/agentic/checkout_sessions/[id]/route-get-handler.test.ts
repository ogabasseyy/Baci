import { PostgrestError } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findGrandfatheredAgenticPaystackDvaReplay } from '@/lib/agentic/agentic-paystack-dva-grandfathered-replay';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { createAdminClient } from '@/lib/supabase/admin';

const {
  mockReadAgenticMutationRequest,
  mockResolveAgenticMerchantContext,
  mockVerifyAgenticApiKey,
} = vi.hoisted(() => ({
  mockReadAgenticMutationRequest: vi.fn(),
  mockResolveAgenticMerchantContext: vi.fn(),
  mockVerifyAgenticApiKey: vi.fn(() => true),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/agentic/agentic-paystack-dva-grandfathered-replay', () => ({
  findGrandfatheredAgenticPaystackDvaReplay: vi.fn(),
}));
vi.mock('@/lib/agentic/auth', () => ({
  verifyAgenticApiKey: mockVerifyAgenticApiKey,
}));
vi.mock('@/lib/agentic/checkout', () => ({
  calculateCheckoutSession: vi.fn(),
}));
vi.mock('@/lib/agentic/merchant-context', () => ({
  resolveAgenticMerchantContextFromRpc: mockResolveAgenticMerchantContext,
}));
vi.mock('@/lib/agentic/mutation-request', () => ({
  readAgenticMutationRequest: mockReadAgenticMutationRequest,
}));
vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

const session = {
  cart_items: [{ id: '', quantity: 0 }],
  currency: 'NGN',
  metadata: {
    agentic: {
      buyer: {
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone_number: '+2348012345678',
      },
      line_items: [
        {
          base_amount: 500_000,
          discount: 0,
          id: 'line_product-1',
          item: {
            id: 'product-1',
            product_id: 'product-1',
            quantity: 1,
            title: 'Phone',
          },
          subtotal: 500_000,
          tax: 0,
          total: 500_000,
        },
      ],
      payment_state: 'payment_pending',
      totals: [{ amount: 500_000, display_text: 'Total Due', type: 'total' }],
    },
  },
  order_id: 'order-1',
  payment_reference: '1234567890',
  session_id: 'agentic_session_1',
  shipping_address: { city: 'Lagos' },
  shipping_method: 'pickup_store_1',
  status: 'processing',
  virtual_account_bank: 'Paystack-Titan',
  virtual_account_name: 'Baci Test',
  virtual_account_number: '1234567890',
};

function mockSessionRead() {
  const chain = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: session, error: null }),
  };
  chain.eq.mockReturnValue(chain);
  const supabase = {
    from: vi.fn(() => ({ select: vi.fn(() => chain) })),
  };
  vi.mocked(createAdminClient).mockReturnValue({} as never);
  vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
    supabase as never
  );
  return supabase;
}

function request() {
  return new NextRequest(
    'http://localhost/api/agentic/checkout_sessions/agentic_session_1'
  );
}

const routeParams = {
  params: Promise.resolve({ id: 'agentic_session_1' }),
};

describe('checkout session get handler in paused DVA mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AGENTIC_PAYSTACK_DVA_MODE', 'paused');
    mockResolveAgenticMerchantContext.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
    });
    mockReadAgenticMutationRequest.mockResolvedValue({
      apiVersion: '2026-04-30',
      body: {},
      idempotencyKey: '',
      method: 'GET',
      ok: true,
      pathname: '/api/agentic/checkout_sessions/agentic_session_1',
      rawBody: '',
      requestId: 'req_123',
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns only the exact validated stored response', async () => {
    const supabase = mockSessionRead();
    const storedResponse = {
      id: 'agentic_session_1',
      marker: 'exact-stored-response',
      status: 'ready_for_payment',
    };
    vi.mocked(findGrandfatheredAgenticPaystackDvaReplay).mockResolvedValue({
      data: { body: storedResponse, status: 200 },
      error: null,
    });

    const { GET } = await import('./route');
    const response = await GET(request(), routeParams);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(storedResponse);
    expect(findGrandfatheredAgenticPaystackDvaReplay).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      session,
      supabase,
    });
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('keeps the existing payment-state read path unchanged when enabled', async () => {
    vi.stubEnv('AGENTIC_PAYSTACK_DVA_MODE', 'enabled');
    mockSessionRead();

    const { GET } = await import('./route');
    const response = await GET(request(), routeParams);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: 'agentic_session_1',
      order_id: 'order-1',
      payment_details: { account_number: '1234567890' },
      status: 'ready_for_payment',
    });
    expect(findGrandfatheredAgenticPaystackDvaReplay).not.toHaveBeenCalled();
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('returns a detail-free conflict when no immutable replay matches', async () => {
    mockSessionRead();
    vi.mocked(findGrandfatheredAgenticPaystackDvaReplay).mockResolvedValue({
      data: null,
      error: null,
    });

    const { GET } = await import('./route');
    const response = await GET(request(), routeParams);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: 'Session already has pending payment',
      order_id: 'order-1',
      status: 'payment_pending',
    });
    expect(JSON.stringify(body)).not.toContain('1234567890');
  });

  it('fails closed when immutable replay lookup fails', async () => {
    mockSessionRead();
    vi.mocked(findGrandfatheredAgenticPaystackDvaReplay).mockResolvedValue({
      data: null,
      error: new PostgrestError({
        code: '42501',
        details: '',
        hint: '',
        message: 'denied',
      }),
    });

    const { GET } = await import('./route');
    const response = await GET(request(), routeParams);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Database error' });
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });
});
