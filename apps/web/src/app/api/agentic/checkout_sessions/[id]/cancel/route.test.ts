import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import {
  reserveAgenticIdempotencyKey,
  storeAgenticIdempotencyResponse,
} from '@/lib/agentic/idempotency';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { createAdminClient } from '@/lib/supabase/admin';

const mockVerifyAgenticApiKey = vi.fn(() => true);
type MockAgenticMerchantContext = {
  agentic_checkout_enabled?: boolean;
  agent_user_agent_allowlist?: string[];
  agent_user_agent_denylist?: string[];
  custom_domain?: string;
  id: string;
  slug: string;
};

const mockResolveAgenticMerchantContext = vi.fn<
  () => Promise<MockAgenticMerchantContext | null>
>(() =>
  Promise.resolve({
    custom_domain: 'ogabassey.com',
    id: 'merchant-1',
    slug: 'ogabassey',
  })
);

vi.mock('@/lib/agentic/auth', () => ({
  verifyAgenticApiKey: mockVerifyAgenticApiKey,
}));

vi.mock('@/lib/agentic/merchant-context', () => ({
  AGENTIC_CHECKOUT_DISABLED_ERROR: 'Agentic checkout disabled',
  isAgenticMerchantCheckoutEnabled: (merchant: {
    agentic_checkout_enabled?: boolean;
  }) => merchant.agentic_checkout_enabled !== false,
  resolveAgenticMerchantContextFromRpc: mockResolveAgenticMerchantContext,
}));

vi.mock('@/lib/agentic/checkout', () => ({
  calculateCheckoutSession: vi.fn(),
}));

vi.mock('@/lib/agentic/request-integrity', () => ({
  AGENTIC_REQUEST_INTEGRITY_ERRORS: {
    INVALID_REQUEST_ID_FORMAT: 'Invalid request ID format',
    INVALID_TIMESTAMP: 'Invalid timestamp',
    MISSING_SIGNING_SECRET: 'Missing signing secret',
    REQUEST_ID_TOO_LONG: 'Request ID too long',
    STALE_TIMESTAMP: 'Stale timestamp',
    UNSUPPORTED_API_VERSION: 'Unsupported api version',
  },
  getAgenticSigningSecrets: vi.fn(() => ['signing-secret']),
  verifyAgenticRequestIntegrity: vi.fn(() => ({
    apiVersion: '2026-04-30',
    ok: true,
    requestId: 'req_123',
  })),
}));

vi.mock('@/lib/agentic/request-replay', () => ({
  reserveAgenticRequestId: vi.fn(),
}));

vi.mock('@/lib/agentic/idempotency', () => ({
  reserveAgenticIdempotencyKey: vi.fn(),
  storeAgenticIdempotencyResponse: vi.fn(),
}));

vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'agentic_session_1',
    cart_items: [{ id: 'product-1', quantity: 1 }],
    shipping_method: 'pickup_store_1',
    shipping_address: { city: 'Lagos' },
    currency: 'NGN',
    status: 'processing',
    order_id: null,
    payment_reference: null,
    virtual_account_number: null,
    metadata: null,
    ...overrides,
  };
}

function mockCheckoutSessionLookup({
  session,
  updateError = null,
}: {
  session: Record<string, unknown> | null;
  updateError?: unknown;
}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: updateError ? null : { session_id: 'agentic_session_1' },
    error: updateError,
  });
  const updateChain = {} as {
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  };
  updateChain.eq = vi.fn(() => updateChain);
  updateChain.in = vi.fn(() => updateChain);
  updateChain.is = vi.fn(() => updateChain);
  updateChain.select = vi.fn(() => ({ maybeSingle }));
  const updateSpy = vi.fn(() => updateChain);
  const readChain = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: session,
      error: null,
    }),
  };
  readChain.eq.mockReturnValue(readChain);

  const mockSupabase = {
    from: vi.fn((table: string) => {
      if (table === 'checkout_sessions') {
        return {
          select: vi.fn(() => readChain),
          update: updateSpy,
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };

  vi.mocked(createAdminClient).mockReturnValue(mockSupabase as never);
  vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
    mockSupabase as never
  );

  return { readChain, updateChain, updateSpy };
}

describe('POST /api/agentic/checkout_sessions/[id]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyAgenticApiKey.mockReturnValue(true);
    mockResolveAgenticMerchantContext.mockResolvedValue({
      custom_domain: 'ogabassey.com',
      id: 'merchant-1',
      slug: 'ogabassey',
    });
    vi.mocked(reserveAgenticRequestId).mockResolvedValue({ ok: true });
    vi.mocked(reserveAgenticIdempotencyKey).mockResolvedValue({
      ok: true,
      state: 'reserved',
    });
    vi.mocked(storeAgenticIdempotencyResponse).mockResolvedValue({
      ok: true,
      error: null,
    });
  });

  it('cancels a session using the stored checkout_sessions columns', async () => {
    const { readChain, updateChain, updateSpy } = mockCheckoutSessionLookup({
      session: buildSession(),
    });
    vi.mocked(calculateCheckoutSession).mockResolvedValue({
      lineItems: [
        {
          id: 'line_product-1',
          item: {
            id: 'product-1',
            product_id: 'product-1',
            quantity: 1,
            title: 'Phone',
          },
          base_amount: 500000,
          discount: 0,
          subtotal: 500000,
          tax: 0,
          total: 500000,
        },
      ],
      totals: [{ type: 'total', display_text: 'Total Due', amount: 500000 }],
      fulfillmentOptions: [],
      selectedOptionId: 'pickup_store_1',
      messages: [],
    });

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/agentic_session_1/cancel',
      { method: 'POST', headers: { 'idempotency-key': 'idem-1' } }
    );
    const params = { params: Promise.resolve({ id: 'agentic_session_1' }) };

    const { POST } = await import('./route');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(readChain.eq).toHaveBeenCalledWith(
      'session_id',
      'agentic_session_1'
    );
    expect(readChain.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(updateSpy).toHaveBeenCalledWith({ status: 'abandoned' });
    expect(updateChain.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(body).toMatchObject({
      id: 'agentic_session_1',
      status: 'canceled',
      currency: 'ngn',
      fulfillment_option_id: 'pickup_store_1',
      links: [
        { type: 'terms_of_use', url: 'https://ogabassey.com/terms' },
        { type: 'privacy_policy', url: 'https://ogabassey.com/privacy' },
      ],
      shipping_address: { city: 'Lagos' },
    });
  });

  it('returns 401 when the agentic API key is invalid', async () => {
    mockVerifyAgenticApiKey.mockReturnValue(false);

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/agentic_session_1/cancel',
      { method: 'POST' }
    );
    const params = { params: Promise.resolve({ id: 'agentic_session_1' }) };

    const { POST } = await import('./route');
    const response = await POST(request, params);

    expect(response.status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('returns 400 when the session id route param is invalid', async () => {
    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/%2E%2E/cancel',
      { method: 'POST', headers: { 'idempotency-key': 'idem-1' } }
    );

    const { POST } = await import('./route');
    const response = await POST(request, {
      params: Promise.resolve({ id: '../bad' }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid route params' });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('returns 403 when the merchant disables agentic checkout', async () => {
    mockResolveAgenticMerchantContext.mockResolvedValueOnce({
      agentic_checkout_enabled: false,
      id: 'merchant-1',
      slug: 'ogabassey',
    });
    vi.mocked(createAdminClient).mockReturnValue({} as never);

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/agentic_session_1/cancel',
      { method: 'POST', headers: { 'idempotency-key': 'idem-1' } }
    );
    const params = { params: Promise.resolve({ id: 'agentic_session_1' }) };

    const { POST } = await import('./route');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Agentic checkout disabled' });
    expect(createAgenticScopedSupabaseClient).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
    });
    expect(reserveAgenticIdempotencyKey).toHaveBeenCalled();
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'idem-1',
        merchantId: 'merchant-1',
        response: { error: 'Agentic checkout disabled' },
        route: 'checkout_sessions.cancel',
        status: 403,
      })
    );
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller user-agent is not allowlisted', async () => {
    mockResolveAgenticMerchantContext.mockResolvedValueOnce({
      agent_user_agent_allowlist: ['trusted-agent'],
      id: 'merchant-1',
      slug: 'ogabassey',
    });
    vi.mocked(createAdminClient).mockReturnValue({} as never);

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/agentic_session_1/cancel',
      { method: 'POST', headers: { 'idempotency-key': 'idem-1' } }
    );
    const params = { params: Promise.resolve({ id: 'agentic_session_1' }) };

    const { POST } = await import('./route');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Agent client not allowlisted' });
    expect(createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
    expect(reserveAgenticIdempotencyKey).not.toHaveBeenCalled();
    expect(storeAgenticIdempotencyResponse).not.toHaveBeenCalled();
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('returns 404 when the checkout session is missing', async () => {
    const { updateSpy } = mockCheckoutSessionLookup({ session: null });

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/missing/cancel',
      { method: 'POST', headers: { 'idempotency-key': 'idem-1' } }
    );
    const params = { params: Promise.resolve({ id: 'missing' }) };

    const { POST } = await import('./route');
    const response = await POST(request, params);

    expect(response.status).toBe(404);
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('rejects cancellation after payment setup has started', async () => {
    const { updateSpy } = mockCheckoutSessionLookup({
      session: buildSession({
        metadata: { agentic: { payment_state: 'payment_pending' } },
        payment_reference: null,
      }),
    });

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/agentic_session_1/cancel',
      { method: 'POST', headers: { 'idempotency-key': 'idem-1' } }
    );
    const params = { params: Promise.resolve({ id: 'agentic_session_1' }) };

    const { POST } = await import('./route');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: 'Session already has pending payment',
      status: 'payment_pending',
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('returns 500 when the cancel update fails', async () => {
    const { updateSpy } = mockCheckoutSessionLookup({
      session: buildSession(),
      updateError: { message: 'write failed' },
    });

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/agentic_session_1/cancel',
      { method: 'POST', headers: { 'idempotency-key': 'idem-1' } }
    );
    const params = { params: Promise.resolve({ id: 'agentic_session_1' }) };

    const { POST } = await import('./route');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Database error' });
    expect(updateSpy).toHaveBeenCalledWith({ status: 'abandoned' });
  });

  it('cancels even when response recalculation fails', async () => {
    const { updateSpy } = mockCheckoutSessionLookup({
      session: buildSession(),
    });
    vi.mocked(calculateCheckoutSession).mockRejectedValue(
      new Error('shipping unavailable')
    );

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/agentic_session_1/cancel',
      { method: 'POST', headers: { 'idempotency-key': 'idem-1' } }
    );
    const params = { params: Promise.resolve({ id: 'agentic_session_1' }) };

    const { POST } = await import('./route');
    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith({ status: 'abandoned' });
    expect(body).toMatchObject({
      id: 'agentic_session_1',
      status: 'canceled',
      line_items: [],
      totals: [],
    });
  });
});
