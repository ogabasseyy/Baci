import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import {
  reserveAgenticIdempotencyKey,
  storeAgenticIdempotencyResponse,
} from '@/lib/agentic/idempotency';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { adaptUcpCheckoutUpdateRequestBody } from '@/lib/agentic/ucp-request-adapters';
import { createAdminClient } from '@/lib/supabase/admin';

type MockAgenticMerchantContext = {
  agentic_checkout_enabled?: boolean;
  agent_user_agent_allowlist?: string[];
  agent_user_agent_denylist?: string[];
  id: string;
  slug: string;
};

const mockResolveAgenticMerchantContext = vi.fn<
  () => Promise<MockAgenticMerchantContext | null>
>(() => Promise.resolve({ id: 'merchant-1', slug: 'ogabassey' }));
const mockVerifyAgenticApiKey = vi.fn(() => true);

vi.mock('@/lib/agentic/auth', () => ({
  verifyAgenticApiKey: mockVerifyAgenticApiKey,
}));
vi.mock('@/lib/agentic/checkout', () => ({
  calculateCheckoutSession: vi.fn(),
}));
vi.mock('@/lib/agentic/idempotency', () => ({
  reserveAgenticIdempotencyKey: vi.fn(),
  storeAgenticIdempotencyResponse: vi.fn(),
}));
vi.mock('@/lib/agentic/merchant-context', () => ({
  AGENTIC_CHECKOUT_DISABLED_ERROR: 'Agentic checkout disabled',
  isAgenticMerchantCheckoutEnabled: (merchant: {
    agentic_checkout_enabled?: boolean;
  }) => merchant.agentic_checkout_enabled !== false,
  resolveAgenticMerchantContextFromRpc: mockResolveAgenticMerchantContext,
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
vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

type MockCheckoutSession = {
  cart_items: Array<{ id: string; quantity: number }>;
  currency: string;
  session_id: string;
  shipping_address: Record<string, unknown> | null;
  shipping_method: string | null;
  status: string;
};

const session: MockCheckoutSession = {
  session_id: 'agentic_session_1',
  status: 'pending',
  cart_items: [{ id: 'product-1', quantity: 1 }],
  currency: 'NGN',
  shipping_method: 'pickup_store_1',
  shipping_address: null,
};

const sessionCalc = {
  lineItems: [
    {
      id: 'line_product-1',
      item: {
        id: 'product-1',
        product_id: 'product-1',
        quantity: 1,
        title: 'Phone',
      },
      base_amount: 500_000,
      discount: 0,
      subtotal: 500_000,
      tax: 0,
      total: 500_000,
    },
  ],
  totals: [
    { type: 'total' as const, display_text: 'Total Due', amount: 500_000 },
  ],
  fulfillmentOptions: [
    {
      type: 'shipping' as const,
      id: 'shipping_standard',
      title: 'Standard Delivery',
      subtotal: 2500,
      tax: 0,
      total: 2500,
    },
  ],
  selectedOptionId: 'shipping_standard',
  messages: [],
};

function createCheckoutSupabaseMock({
  readError = null,
  readSession = session,
  updateData = { session_id: 'agentic_session_1' },
  updateError = null,
}: {
  readError?: unknown;
  readSession?: typeof session | null;
  updateData?: { session_id: string } | null;
  updateError?: unknown;
} = {}) {
  const readMaybeSingle = vi.fn().mockResolvedValue({
    data: readSession,
    error: readError,
  });
  const readChain = {
    eq: vi.fn(),
    maybeSingle: readMaybeSingle,
  };
  readChain.eq.mockReturnValue(readChain);

  const maybeSingle = vi.fn().mockResolvedValue({
    data: updateData,
    error: updateError,
  });
  const updateChain = {
    eq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    select: vi.fn(() => ({ maybeSingle })),
  };
  updateChain.eq.mockReturnValue(updateChain);
  updateChain.in.mockReturnValue(updateChain);
  updateChain.is.mockReturnValue(updateChain);

  const select = vi.fn(() => readChain);
  const update = vi.fn(() => updateChain);
  const from = vi.fn(() => ({ select, update }));
  const serviceFrom = vi.fn();

  return {
    from,
    maybeSingle,
    readChain,
    scopedSupabase: { from } as unknown as SupabaseClient,
    select,
    serviceSupabase: { from: serviceFrom } as unknown as SupabaseClient,
    serviceFrom,
    update,
    updateChain,
  };
}

function createRequest(body: unknown, method: 'POST' | 'PUT' = 'POST') {
  return new NextRequest(
    'http://localhost/api/agentic/checkout_sessions/agentic_session_1',
    {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'idem-1',
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }
  );
}

function routeParams() {
  return { params: Promise.resolve({ id: 'agentic_session_1' }) };
}

function useCheckoutSupabaseMock(
  mock: ReturnType<typeof createCheckoutSupabaseMock>
) {
  vi.mocked(createAdminClient).mockReturnValue(mock.serviceSupabase);
  vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
    mock.scopedSupabase
  );
}

describe('POST /api/agentic/checkout_sessions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAgenticMerchantContext.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
    });
    mockVerifyAgenticApiKey.mockReturnValue(true);
    vi.mocked(calculateCheckoutSession).mockResolvedValue(sessionCalc);
    vi.mocked(reserveAgenticIdempotencyKey).mockResolvedValue({
      ok: true,
      state: 'reserved',
    });
    vi.mocked(storeAgenticIdempotencyResponse).mockResolvedValue({
      ok: true,
      error: null,
    });
    vi.mocked(reserveAgenticRequestId).mockResolvedValue({ ok: true });
  });

  it('returns 400 when the request body cannot be parsed', async () => {
    const { POST } = await import('./route');
    const response = await POST(createRequest('{invalid-json'), routeParams());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 401 when API key verification fails and skips DB calls', async () => {
    mockVerifyAgenticApiKey.mockReturnValue(false);

    const { POST } = await import('./route');
    const response = await POST(createRequest({ items: [] }), routeParams());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('returns 400 when the session id route param is invalid', async () => {
    const { POST } = await import('./route');
    const response = await POST(createRequest({ items: [] }), {
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

    const { POST } = await import('./route');
    const response = await POST(
      createRequest({ shipping_address: { city: 'Lagos' } }),
      routeParams()
    );
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
        route: 'checkout_sessions.update',
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

    const { POST } = await import('./route');
    const response = await POST(
      createRequest({ shipping_address: { city: 'Lagos' } }),
      routeParams()
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Agent client not allowlisted' });
    expect(createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
    expect(reserveAgenticIdempotencyKey).not.toHaveBeenCalled();
    expect(storeAgenticIdempotencyResponse).not.toHaveBeenCalled();
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('updates an existing checkout session with merchant-scoped guards', async () => {
    const mock = createCheckoutSupabaseMock();
    useCheckoutSupabaseMock(mock);

    const { POST } = await import('./route');
    const response = await POST(
      createRequest({
        shipping_address: { address: '12 Example Street', city: 'Lagos' },
        fulfillment_option_id: 'shipping_standard',
      }),
      routeParams()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: 'agentic_session_1',
      status: 'ready_for_payment',
      fulfillment_option_id: 'shipping_standard',
      shipping_address: { address: '12 Example Street', city: 'Lagos' },
    });
    expect(mock.readChain.eq).toHaveBeenCalledWith(
      'session_id',
      'agentic_session_1'
    );
    expect(mock.readChain.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(mock.serviceFrom).not.toHaveBeenCalledWith('checkout_sessions');
    expect(mock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        cart_items: [{ id: 'product-1', quantity: 1 }],
        shipping_method: 'shipping_standard',
        status: 'processing',
      })
    );
    expect(mock.updateChain.eq).toHaveBeenCalledWith(
      'session_id',
      'agentic_session_1'
    );
    expect(mock.updateChain.eq).toHaveBeenCalledWith(
      'merchant_id',
      'merchant-1'
    );
    expect(mock.updateChain.is).toHaveBeenCalledWith('order_id', null);
    expect(mock.updateChain.is).toHaveBeenCalledWith('payment_reference', null);
    expect(mock.updateChain.is).toHaveBeenCalledWith(
      'virtual_account_number',
      null
    );
  });

  it('updates checkout items from an ACP line_items payload without an adapter', async () => {
    const mock = createCheckoutSupabaseMock({
      readSession: {
        ...session,
        cart_items: [{ id: 'old-product', quantity: 1 }],
      },
    });
    useCheckoutSupabaseMock(mock);

    const { POST } = await import('./route');
    const response = await POST(
      createRequest({
        capabilities: {},
        line_items: [{ id: 'product-2', quantity: 2 }],
      }),
      routeParams()
    );

    expect(response.status).toBe(200);
    expect(calculateCheckoutSession).toHaveBeenCalledWith(
      mock.scopedSupabase,
      [{ id: 'product-2', quantity: 2 }],
      'pickup_store_1',
      'NGN',
      'merchant-1'
    );
    expect(mock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        cart_items: [{ id: 'product-2', quantity: 2 }],
      })
    );
  });

  it('updates checkout fulfillment from native ACP selected options and fulfillment_details', async () => {
    const mock = createCheckoutSupabaseMock();
    useCheckoutSupabaseMock(mock);

    const { POST } = await import('./route');
    const response = await POST(
      createRequest({
        fulfillment_details: {
          name: 'Ada Buyer',
          address: {
            line_one: '12 Example Street',
            city: 'Lagos',
            state: 'LA',
            country: 'NG',
            postal_code: '100001',
          },
        },
        selected_fulfillment_options: [
          {
            type: 'shipping',
            option_id: 'shipping_standard',
            item_ids: ['line_product-1'],
          },
        ],
      }),
      routeParams()
    );

    expect(response.status).toBe(200);
    expect(calculateCheckoutSession).toHaveBeenCalledWith(
      mock.scopedSupabase,
      [{ id: 'product-1', quantity: 1 }],
      'shipping_standard',
      'NGN',
      'merchant-1'
    );
    expect(mock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        shipping_address: expect.objectContaining({
          address: '12 Example Street',
          country_code: 'NG',
        }),
        shipping_method: 'shipping_standard',
      })
    );
  });

  it('supports PUT updates for UCP checkout operation compatibility', async () => {
    const mock = createCheckoutSupabaseMock();
    useCheckoutSupabaseMock(mock);

    const { PUT } = await import('./route');
    const response = await PUT(
      createRequest(
        {
          shipping_address: { address: '12 Example Street', city: 'Lagos' },
          fulfillment_option_id: 'shipping_standard',
        },
        'PUT'
      ),
      routeParams()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: 'agentic_session_1',
      status: 'ready_for_payment',
      fulfillment_option_id: 'shipping_standard',
      shipping_address: { address: '12 Example Street', city: 'Lagos' },
    });
    expect(reserveAgenticIdempotencyKey).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'PUT',
      })
    );
  });

  it('replaces checkout items from UCP line_items and clears omitted checkout fields', async () => {
    const existingAddress = { address: 'Old Street', city: 'Lagos' };
    const mock = createCheckoutSupabaseMock({
      readSession: {
        ...session,
        cart_items: [{ id: 'old-product', quantity: 1 }],
        shipping_address: existingAddress,
      },
    });
    useCheckoutSupabaseMock(mock);

    const { handleAgenticCheckoutSessionUpdate } = await import(
      './checkout-session-update-handler'
    );
    const response = await handleAgenticCheckoutSessionUpdate(
      createRequest(
        {
          line_items: [
            {
              item: { id: 'product-2', price: 250000, title: 'Case' },
              quantity: 2,
            },
          ],
        },
        'PUT'
      ),
      routeParams(),
      { requestBodyAdapter: adaptUcpCheckoutUpdateRequestBody }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(calculateCheckoutSession).toHaveBeenCalledWith(
      mock.scopedSupabase,
      [{ id: 'product-2', quantity: 2 }],
      null,
      'NGN',
      'merchant-1'
    );
    expect(mock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        cart_items: [{ id: 'product-2', quantity: 2 }],
        shipping_address: null,
      })
    );
    expect(body).toMatchObject({
      id: 'agentic_session_1',
      shipping_address: null,
    });
  });

  it('returns 500 when the guarded checkout session update fails', async () => {
    const mock = createCheckoutSupabaseMock({
      updateData: null,
      updateError: { message: 'write failed' },
    });
    useCheckoutSupabaseMock(mock);

    const { POST } = await import('./route');
    const response = await POST(
      createRequest({ shipping_address: { city: 'Lagos' } }),
      routeParams()
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Database error' });
  });
});
