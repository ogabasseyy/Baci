import { after, NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAgenticQueryRequest } from '@/lib/agentic/mutation-request';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { createAdminClient } from '@/lib/supabase/admin';

const {
  mockAfter,
  mockReadAgenticQueryRequest,
  mockResolveAgenticMerchantContext,
  mockVerifyAgenticApiKey,
} = vi.hoisted(() => ({
  mockAfter: vi.fn(),
  mockReadAgenticQueryRequest: vi.fn(),
  mockResolveAgenticMerchantContext: vi.fn(),
  mockVerifyAgenticApiKey: vi.fn(() => true),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/server', async () => {
  const actual =
    await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: mockAfter,
  };
});
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
vi.mock('@/lib/agentic/mutation-request', () => ({
  readAgenticQueryRequest: mockReadAgenticQueryRequest,
}));
vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

const orderId = '11111111-1111-4111-8111-111111111111';
const checkoutSessionId = 'agentic_session_1';
const afterCallbacks: Array<() => void | Promise<void>> = [];

const orderRow = {
  created_at: '2026-04-28T12:00:00.000Z',
  currency: 'NGN',
  discount_amount: 0,
  id: orderId,
  order_number: 'BACI-2026-0001',
  order_items: [
    {
      id: 'line-1',
      fulfillment_data: null,
      line_extension_amount: 100_000,
      name: 'Test laptop',
      price: 100_000,
      product_id: '22222222-2222-4222-8222-222222222222',
      quantity: 1,
      variant_id: null,
      vat_amount: 0,
    },
  ],
  payment_status: 'pending',
  shipping_address: null,
  shipping_fee: 0,
  shipping_status: 'pending',
  subtotal: 100_000,
  tax_amount: 0,
  tracking_number: null,
  total: 100_000,
  updated_at: '2026-04-28T12:00:00.000Z',
};

function request() {
  return new NextRequest(
    `https://ogabassey.com/api/agentic/orders/${orderId}`,
    {
      headers: { authorization: 'Bearer test' },
    }
  );
}

function routeParams(id = orderId) {
  return { params: Promise.resolve({ id }) };
}

async function flushAfterCallbacks() {
  for (const callback of afterCallbacks.splice(0)) {
    await callback();
  }
}

function mockOrderRead({
  checkoutSession = { session_id: checkoutSessionId },
  checkoutSessionError = null,
  data,
  error = null,
  requestRecordError = null,
  requestRecordPurgeError = null,
}: {
  checkoutSession?: Record<string, unknown> | null;
  checkoutSessionError?: unknown;
  data: Record<string, unknown> | null;
  error?: unknown;
  requestRecordError?: unknown;
  requestRecordPurgeError?: unknown;
}) {
  const orderChain = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  orderChain.eq.mockReturnValue(orderChain);
  const checkoutSessionChain = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: checkoutSession,
      error: checkoutSessionError,
    }),
  };
  checkoutSessionChain.eq.mockReturnValue(checkoutSessionChain);
  const select = vi.fn((_projection: string) => orderChain);
  const checkoutSessionSelect = vi.fn(
    (_projection: string) => checkoutSessionChain
  );
  const requestRecordDeleteChain = {
    eq: vi.fn(),
    lt: vi.fn().mockResolvedValue({ error: requestRecordPurgeError }),
  };
  requestRecordDeleteChain.eq.mockReturnValue(requestRecordDeleteChain);
  const requestRecordInsert = vi
    .fn()
    .mockResolvedValue({ error: requestRecordError });
  const scopedSupabase = {
    from: vi.fn((table: string) => {
      if (table === 'orders') return { select };
      if (table === 'checkout_sessions') {
        return { select: checkoutSessionSelect };
      }
      if (table === 'agentic_request_records') {
        return {
          delete: vi.fn(() => requestRecordDeleteChain),
          insert: requestRecordInsert,
        };
      }
      throw new Error(`Unexpected scoped table ${table}`);
    }),
  };
  vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
    scopedSupabase as never
  );
  return {
    checkoutSessionChain,
    checkoutSessionSelect,
    orderChain,
    requestRecordDeleteChain,
    requestRecordInsert,
    scopedSupabase,
    select,
  };
}

describe('GET /api/agentic/orders/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterCallbacks.length = 0;
    mockAfter.mockImplementation((callback: () => void | Promise<void>) => {
      afterCallbacks.push(callback);
    });
    mockVerifyAgenticApiKey.mockReturnValue(true);
    mockResolveAgenticMerchantContext.mockResolvedValue({
      custom_domain: 'ogabassey.com',
      id: 'merchant-1',
      slug: 'ogabassey',
    });
    mockReadAgenticQueryRequest.mockResolvedValue({
      agentId: 'openai:chatgpt',
      apiVersion: '2026-04-30',
      body: {},
      idempotencyKey: '',
      method: 'GET',
      ok: true,
      pathname: `/api/agentic/orders/${orderId}`,
      rawBody: '',
      requestId: 'req_123',
    });
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(),
    } as never);
  });

  it('returns public post-purchase order state for an agentic order', async () => {
    const {
      orderChain,
      requestRecordDeleteChain,
      requestRecordInsert,
      scopedSupabase,
      select,
    } = mockOrderRead({
      data: orderRow,
    });

    const { GET } = await import('./route');
    const response = await GET(request(), routeParams());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      checkout_id: checkoutSessionId,
      currency: 'NGN',
      id: orderId,
      line_items: [
        {
          id: 'line-1',
          item: {
            id: '22222222-2222-4222-8222-222222222222',
            price: 100_000,
            title: 'Test laptop',
          },
          quantity: { fulfilled: 0, total: 1 },
          status: 'processing',
        },
      ],
      links: {
        support: 'https://ogabassey.com/contact',
        track_order: 'https://ogabassey.com/track-order',
      },
      order_number: 'BACI-2026-0001',
      payment_status: 'pending',
      shipping_status: 'pending',
      totals: [
        { amount: 100_000, display_text: 'Subtotal', type: 'subtotal' },
        { amount: 100_000, display_text: 'Total', type: 'total' },
      ],
      ucp: {
        capabilities: {
          'dev.ucp.shopping.order': [{ version: '2026-04-08' }],
        },
        status: 'success',
        version: '2026-04-08',
      },
    });
    expect(orderChain.eq).toHaveBeenCalledWith('id', orderId);
    expect(orderChain.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(orderChain.eq).toHaveBeenCalledWith('source', 'agentic_ai');
    expect(scopedSupabase.from).toHaveBeenCalledWith('checkout_sessions');
    expect(select).toHaveBeenCalledWith(
      'id, order_number, payment_status, shipping_status, tracking_number, created_at, updated_at, subtotal, shipping_fee, discount_amount, tax_amount, total, currency, shipping_address, order_items(id, product_id, variant_id, name, price, quantity, line_extension_amount, vat_amount, fulfillment_data)'
    );
    const projection = vi.mocked(select).mock.calls[0]?.[0] ?? '';
    expect(projection).not.toMatch(/(^|,\s*)status(\s*,|$)/);
    expect(after).toHaveBeenCalledOnce();
    expect(requestRecordInsert).not.toHaveBeenCalled();

    await flushAfterCallbacks();

    expect(requestRecordDeleteChain.eq).toHaveBeenCalledWith(
      'merchant_id',
      'merchant-1'
    );
    expect(requestRecordInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: 'openai:chatgpt',
        api_version: '2026-04-30',
        merchant_id: 'merchant-1',
        request_id: 'req_123',
        route: 'orders.read',
        status_code: 200,
      })
    );
  });

  it('returns 401 when API key verification fails', async () => {
    mockVerifyAgenticApiKey.mockReturnValue(false);

    const { GET } = await import('./route');
    const response = await GET(request(), routeParams());

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: 'Unauthorized',
      messages: [
        {
          content: 'Unauthorized',
          content_type: 'plain',
          type: 'error',
        },
      ],
      ucp: {
        status: 'error',
      },
    });
    expect(readAgenticQueryRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
  });

  it('requires signed read integrity without requiring idempotency', async () => {
    mockReadAgenticQueryRequest.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      ),
    });

    const { GET } = await import('./route');
    const response = await GET(request(), routeParams());

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: 'Invalid signature',
      messages: [
        {
          content: 'Invalid signature',
          content_type: 'plain',
          type: 'error',
        },
      ],
      ucp: {
        status: 'error',
      },
    });
    expect(readAgenticQueryRequest).toHaveBeenCalledWith({
      request: expect.any(NextRequest),
    });
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('returns 400 before DB access when the order id route param is invalid', async () => {
    const { GET } = await import('./route');
    const response = await GET(request(), routeParams('../order-1'));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'Invalid route params',
      ucp: {
        status: 'error',
      },
    });
    expect(readAgenticQueryRequest).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('returns 500 when the configured agentic merchant cannot be resolved', async () => {
    mockResolveAgenticMerchantContext.mockResolvedValueOnce(null);

    const { GET } = await import('./route');
    const response = await GET(request(), routeParams());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: 'Agentic merchant not found',
      messages: [
        {
          content: 'Agentic merchant not found',
          content_type: 'plain',
          type: 'error',
        },
      ],
      ucp: {
        status: 'error',
      },
    });
    expect(createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
  });

  it('allows existing order reads when the merchant disables agentic checkout', async () => {
    mockResolveAgenticMerchantContext.mockResolvedValueOnce({
      agentic_checkout_enabled: false,
      custom_domain: 'ogabassey.com',
      id: 'merchant-1',
      slug: 'ogabassey',
    });
    mockOrderRead({ data: orderRow });

    const { GET } = await import('./route');
    const response = await GET(request(), routeParams());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: orderId,
      payment_status: 'pending',
      shipping_status: 'pending',
    });
    expect(createAgenticScopedSupabaseClient).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
    });
  });

  it('returns 403 when the caller user-agent is not allowlisted', async () => {
    mockResolveAgenticMerchantContext.mockResolvedValueOnce({
      agent_user_agent_allowlist: ['trusted-agent'],
      custom_domain: 'ogabassey.com',
      id: 'merchant-1',
      slug: 'ogabassey',
    });

    const { GET } = await import('./route');
    const response = await GET(request(), routeParams());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: 'Agent client not allowlisted',
      messages: [
        {
          content: 'Agent client not allowlisted',
          content_type: 'plain',
          type: 'error',
        },
      ],
      ucp: {
        status: 'error',
      },
    });
    expect(readAgenticQueryRequest).toHaveBeenCalled();
    expect(createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
  });

  it('returns 404 when the scoped agentic order is not found', async () => {
    mockOrderRead({ data: null });

    const { GET } = await import('./route');
    const response = await GET(request(), routeParams());

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: 'Order not found',
      messages: [
        {
          content: 'Order not found',
          content_type: 'plain',
          type: 'error',
        },
      ],
      ucp: {
        status: 'error',
      },
    });
  });

  it('returns 500 when the scoped order query fails', async () => {
    const { requestRecordInsert } = mockOrderRead({
      data: null,
      error: { message: 'db unavailable' },
    });

    const { GET } = await import('./route');
    const response = await GET(request(), routeParams());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: 'Failed to fetch order',
      messages: [
        {
          content: 'Failed to fetch order',
          content_type: 'plain',
          type: 'error',
        },
      ],
      ucp: {
        status: 'error',
      },
    });
    await flushAfterCallbacks();

    expect(requestRecordInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        route: 'orders.read',
        status_code: 500,
      })
    );
  });

  it('does not replace a successful order read when outcome recording fails', async () => {
    mockOrderRead({
      data: orderRow,
      requestRecordError: { message: 'audit unavailable' },
      requestRecordPurgeError: { message: 'purge unavailable' },
    });

    const { GET } = await import('./route');
    const response = await GET(request(), routeParams());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: orderId,
      order_number: 'BACI-2026-0001',
    });
    await expect(flushAfterCallbacks()).resolves.toBeUndefined();
  });

  it('returns a schema-safe checkout id fallback when checkout linkage is absent', async () => {
    mockOrderRead({ checkoutSession: null, data: orderRow });

    const { GET } = await import('./route');
    const response = await GET(request(), routeParams());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      checkout_id: orderId,
      id: orderId,
      order_number: 'BACI-2026-0001',
    });
  });

  it('returns 500 when the linked checkout session query fails', async () => {
    mockOrderRead({
      checkoutSession: null,
      checkoutSessionError: { message: 'checkout unavailable' },
      data: orderRow,
    });

    const { GET } = await import('./route');
    const response = await GET(request(), routeParams());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: 'Failed to fetch order checkout session',
      messages: [
        {
          content: 'Failed to fetch order checkout session',
          content_type: 'plain',
          type: 'error',
        },
      ],
      ucp: {
        status: 'error',
      },
    });
  });

  it('does not use a service-role bypass client for order data reads', async () => {
    const adminSupabase = { from: vi.fn() };
    vi.mocked(createAdminClient).mockReturnValue(adminSupabase as never);
    const { scopedSupabase } = mockOrderRead({ data: orderRow });

    const { GET } = await import('./route');
    const response = await GET(request(), routeParams());

    expect(response.status).toBe(200);
    expect(adminSupabase.from).not.toHaveBeenCalled();
    expect(scopedSupabase.from).toHaveBeenCalledWith('orders');
    expect(createAgenticScopedSupabaseClient).toHaveBeenCalledWith({
      merchantId: 'merchant-1',
      merchantSlug: 'ogabassey',
    });
  });
});
