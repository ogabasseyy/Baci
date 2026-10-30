import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import { readAgenticMutationRequest } from '@/lib/agentic/mutation-request';
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
vi.mock('@/lib/agentic/auth', () => ({
  verifyAgenticApiKey: mockVerifyAgenticApiKey,
}));
vi.mock('@/lib/agentic/checkout', () => ({
  calculateCheckoutSession: vi.fn(),
}));
vi.mock('@/lib/agentic/merchant-context', () => ({
  AGENTIC_CHECKOUT_DISABLED_ERROR: 'Agentic checkout disabled',
  isAgenticMerchantCheckoutEnabled: (merchant: {
    agentic_checkout_enabled?: boolean;
  }) => merchant.agentic_checkout_enabled !== false,
  resolveAgenticMerchantContextFromRpc: mockResolveAgenticMerchantContext,
}));
vi.mock('@/lib/agentic/mutation-request', () => ({
  readAgenticMutationRequest: mockReadAgenticMutationRequest,
}));
vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

function routeParams() {
  return { params: Promise.resolve({ id: 'agentic_session_1' }) };
}

function mockCheckoutSessionRead(session: Record<string, unknown> | null) {
  const readChain = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: session, error: null }),
  };
  readChain.eq.mockReturnValue(readChain);
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'checkout_sessions')
        return { select: vi.fn(() => readChain) };
      throw new Error(`Unexpected table ${table}`);
    }),
  };
  vi.mocked(createAdminClient).mockReturnValue(supabase as never);
  vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
    supabase as never
  );
}

const storedCheckoutSnapshot = {
  line_items: [
    {
      base_amount: 500000,
      discount: 0,
      id: 'line_product-1',
      item: {
        id: 'product-1',
        product_id: 'product-1',
        quantity: 1,
        title: 'Phone',
      },
      subtotal: 500000,
      tax: 0,
      total: 500000,
    },
  ],
  totals: [{ type: 'total', display_text: 'Total Due', amount: 500000 }],
};

describe('GET /api/agentic/checkout_sessions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyAgenticApiKey.mockReturnValue(true);
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

  it('returns 401 when API key verification fails and skips DB calls', async () => {
    mockVerifyAgenticApiKey.mockReturnValue(false);

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/agentic_session_1'
    );

    const { GET } = await import('./route');
    const response = await GET(request, routeParams());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(readAgenticMutationRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('requires signed request integrity without requiring idempotency for reads', async () => {
    mockReadAgenticMutationRequest.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      ),
    });

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/agentic_session_1'
    );

    const { GET } = await import('./route');
    const response = await GET(request, routeParams());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Invalid signature' });
    expect(readAgenticMutationRequest).toHaveBeenCalledWith({
      request,
      requireIdempotency: false,
    });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('returns 400 when the session id route param is invalid', async () => {
    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/%2E%2E'
    );

    const { GET } = await import('./route');
    const response = await GET(request, {
      params: Promise.resolve({ id: '../bad' }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid route params' });
    expect(readAgenticMutationRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('allows existing session reads when the merchant disables agentic checkout', async () => {
    mockResolveAgenticMerchantContext.mockResolvedValueOnce({
      agentic_checkout_enabled: false,
      id: 'merchant-1',
      slug: 'ogabassey',
    });
    mockCheckoutSessionRead({
      session_id: 'agentic_session_1',
      status: 'processing',
      cart_items: [{ id: 'product-1', quantity: 1 }],
      currency: 'NGN',
      shipping_method: 'pickup_store_1',
      shipping_address: { city: 'Lagos' },
      order_id: null,
      payment_reference: null,
      virtual_account_number: null,
      metadata: null,
    });
    vi.mocked(calculateCheckoutSession).mockResolvedValue({
      fulfillmentOptions: [],
      lineItems: [],
      messages: [],
      selectedOptionId: undefined,
      totals: [],
    });

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/agentic_session_1'
    );

    const { GET } = await import('./route');
    const response = await GET(request, routeParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: 'agentic_session_1' });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(createAgenticScopedSupabaseClient).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
    });
  });

  it('returns 500 when stored cart items are malformed', async () => {
    mockCheckoutSessionRead({
      session_id: 'agentic_session_1',
      status: 'processing',
      cart_items: [{ id: '', quantity: 0 }],
      currency: 'NGN',
      shipping_method: 'pickup_store_1',
      shipping_address: { city: 'Lagos' },
      order_id: null,
      payment_reference: null,
      virtual_account_number: null,
      metadata: null,
    });

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/agentic_session_1'
    );

    const { GET } = await import('./route');
    const response = await GET(request, routeParams());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Invalid session cart items' });
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('returns stored pending-payment state before cart recalculation', async () => {
    // Malformed cart items prove payment_pending recovery bypasses cart validation.
    mockCheckoutSessionRead({
      session_id: 'agentic_session_1',
      status: 'processing',
      cart_items: [{ id: '', quantity: 0 }],
      currency: 'NGN',
      shipping_method: 'pickup_store_1',
      shipping_address: { city: 'Lagos' },
      order_id: 'order-1',
      payment_reference: '1234567890',
      virtual_account_bank: 'Paystack-Titan',
      virtual_account_name: 'Baci Test',
      virtual_account_number: '1234567890',
      metadata: {
        agentic: {
          buyer: {
            email: 'buyer@example.com',
            first_name: 'Ada',
            last_name: 'Lovelace',
            phone_number: '+2348012345678',
          },
          payment_state: 'payment_pending',
          ...storedCheckoutSnapshot,
        },
      },
    });
    vi.mocked(calculateCheckoutSession).mockRejectedValue(
      new Error('calculation failed')
    );

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/agentic_session_1'
    );

    const { GET } = await import('./route');
    const response = await GET(request, routeParams());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      id: 'agentic_session_1',
      line_items: storedCheckoutSnapshot.line_items,
      order_id: 'order-1',
      payment_details: {
        account_name: 'Baci Test',
        account_number: '1234567890',
        bank_name: 'Paystack-Titan',
      },
      status: 'ready_for_payment',
      totals: storedCheckoutSnapshot.totals,
    });
  });

  it('returns 500 when checkout calculation fails', async () => {
    mockCheckoutSessionRead({
      session_id: 'agentic_session_1',
      status: 'processing',
      cart_items: [{ id: 'product-1', quantity: 1 }],
      currency: 'NGN',
      shipping_method: 'pickup_store_1',
      shipping_address: { city: 'Lagos' },
      order_id: null,
      payment_reference: null,
      virtual_account_number: null,
      metadata: null,
    });
    vi.mocked(calculateCheckoutSession).mockRejectedValue(
      new Error('calculation failed')
    );

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/agentic_session_1'
    );

    const { GET } = await import('./route');
    const response = await GET(request, routeParams());
    const body = await response.json();

    expect(calculateCheckoutSession).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Checkout calculation failed' });
  });
});
