import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import {
  reserveAgenticIdempotencyKey,
  storeAgenticIdempotencyResponse,
} from '@/lib/agentic/idempotency';
import {
  readAgenticMutationRequest,
  readAgenticQueryRequest,
} from '@/lib/agentic/mutation-request';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';

const mockVerifyAgenticApiKey = vi.hoisted(() => vi.fn(() => true));
const mockResolveAgenticMerchantContext = vi.hoisted(() =>
  vi.fn(async () => ({
    agent_user_agent_allowlist: [],
    agent_user_agent_denylist: [],
    agentic_checkout_enabled: true,
    business_name: 'Ogabassey',
    custom_domain: undefined,
    id: 'merchant-1',
    pay_on_delivery_enabled: false,
    paystack_subaccount_code: null,
    slug: 'ogabassey',
  }))
);

vi.mock('@/lib/agentic/auth', () => ({
  verifyAgenticApiKey: mockVerifyAgenticApiKey,
}));

vi.mock('@/lib/agentic/agent-request-controls', () => ({
  verifyAgenticRequestAccess: vi.fn(() => ({ ok: true })),
}));

vi.mock('@/lib/agentic/checkout', () => ({
  calculateCheckoutSession: vi.fn(),
}));

vi.mock('@/lib/agentic/idempotency', () => ({
  reserveAgenticIdempotencyKey: vi.fn(),
  storeAgenticIdempotencyResponse: vi.fn(),
}));

vi.mock('@/lib/agentic/merchant-context', () => ({
  resolveAgenticMerchantContext: mockResolveAgenticMerchantContext,
}));

vi.mock('@/lib/agentic/mutation-request', () => ({
  readAgenticMutationRequest: vi.fn(),
  readAgenticQueryRequest: vi.fn(),
}));

vi.mock('@/lib/agentic/request-replay', () => ({
  reserveAgenticRequestId: vi.fn(),
}));

vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({})),
}));

function createChain(result: { data: unknown; error: unknown }) {
  const chain = {
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue(result),
    select: vi.fn(() => chain),
    update: vi.fn(() => chain),
  };
  return chain;
}

function createSupabaseMock({
  cartResult,
  updateResult = { data: { cart_id: 'cart_123' }, error: null },
}: {
  cartResult: { data: unknown; error: unknown };
  updateResult?: { data: unknown; error: unknown };
}) {
  const selectChain = createChain(cartResult);
  const updateChain = createChain(updateResult);
  const from = vi.fn((table: string) => {
    if (table !== 'agentic_cart_sessions') {
      throw new Error(`Unexpected table ${table}`);
    }
    return {
      select: selectChain.select,
      update: updateChain.update,
    };
  });
  const supabase = { from };
  vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
    supabase as never
  );
  return { selectChain, supabase, updateChain };
}

function mockQuery() {
  vi.mocked(readAgenticQueryRequest).mockResolvedValue({
    agentId: 'openai-agent',
    apiVersion: '2026-04-30',
    body: {},
    idempotencyKey: '',
    method: 'GET',
    ok: true,
    pathname: '/api/agentic/carts/cart_123',
    rawBody: '',
    requestId: 'req-1',
  });
}

function mockMutation(body: unknown) {
  vi.mocked(readAgenticMutationRequest).mockResolvedValue({
    agentId: 'openai-agent',
    apiVersion: '2026-04-30',
    body,
    idempotencyKey: 'idem-1',
    method: 'POST',
    ok: true,
    pathname: '/api/agentic/carts/cart_123',
    rawBody: JSON.stringify(body),
    requestId: 'req-1',
  });
}

function mockCalculation(quantity = 1, productId = 'product-1') {
  const total = 500000 * quantity;
  vi.mocked(calculateCheckoutSession).mockResolvedValue({
    fulfillmentOptions: [],
    lineItems: [
      {
        base_amount: total,
        discount: 0,
        id: `line_${productId}`,
        item: {
          id: productId,
          product_id: productId,
          quantity,
          title: 'Phone',
        },
        subtotal: total,
        tax: 0,
        total,
      },
    ],
    messages: [],
    selectedOptionId: undefined,
    totals: [{ amount: total, display_text: 'Total', type: 'total' }],
  });
}

describe('/api/agentic/carts/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyAgenticApiKey.mockReturnValue(true);
    vi.mocked(reserveAgenticIdempotencyKey).mockResolvedValue({
      ok: true,
      state: 'reserved',
    });
    vi.mocked(reserveAgenticRequestId).mockResolvedValue({ ok: true });
    vi.mocked(storeAgenticIdempotencyResponse).mockResolvedValue({
      error: null,
      ok: true,
    });
  });

  it('returns 401 when the agent key is missing', async () => {
    mockVerifyAgenticApiKey.mockReturnValue(false);

    const { GET } = await import('./route');
    const response = await GET(
      new NextRequest('http://localhost/api/agentic/carts/cart_123'),
      { params: Promise.resolve({ id: 'cart_123' }) }
    );

    expect(response.status).toBe(401);
    expect(readAgenticQueryRequest).not.toHaveBeenCalled();
  });

  it('returns 404 when a cart id is unknown', async () => {
    mockQuery();
    createSupabaseMock({ cartResult: { data: null, error: null } });

    const { GET } = await import('./route');
    const response = await GET(
      new NextRequest('http://localhost/api/agentic/carts/missing'),
      { params: Promise.resolve({ id: 'missing' }) }
    );

    expect(response.status).toBe(404);
  });

  it('returns the stored active cart with recalculated totals', async () => {
    mockQuery();
    mockCalculation();
    createSupabaseMock({
      cartResult: {
        data: {
          agent_id: 'openai-agent',
          buyer: {},
          cart_id: 'cart_123',
          cart_items: [{ id: 'product-1', quantity: 1 }],
          checkout_session_id: null,
          currency: 'NGN',
          id: 'row-1',
          merchant_id: 'merchant-1',
          metadata: {},
          shipping_address: null,
          status: 'active',
        },
        error: null,
      },
    });

    const { GET } = await import('./route');
    const response = await GET(
      new NextRequest('http://localhost/api/agentic/carts/cart_123'),
      { params: Promise.resolve({ id: 'cart_123' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: 'cart_123',
      status: 'active',
      totals: [{ amount: 500000, display_text: 'Total', type: 'total' }],
    });
  });

  it('updates line items and preserves buyer context', async () => {
    mockMutation({
      line_items: [{ item: { id: 'product-2' }, quantity: 2 }],
    });
    mockCalculation(2, 'product-2');
    createSupabaseMock({
      cartResult: {
        data: {
          agent_id: 'openai-agent',
          buyer: { email: 'buyer@example.com' },
          cart_id: 'cart_123',
          cart_items: [{ id: 'product-1', quantity: 1 }],
          checkout_session_id: null,
          currency: 'NGN',
          id: 'row-1',
          merchant_id: 'merchant-1',
          metadata: {},
          shipping_address: null,
          status: 'active',
        },
        error: null,
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/carts/cart_123', {
        body: JSON.stringify({
          line_items: [{ item: { id: 'product-2' }, quantity: 2 }],
        }),
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'cart_123' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.line_items[0].item.id).toBe('product-2');
    expect(body.line_items[0].quantity).toBe(2);
  });

  it('rejects updates to a migrated cart with a canonical refresh outcome', async () => {
    mockMutation({
      line_items: [{ item: { id: 'product-2' }, quantity: 2 }],
    });
    const { updateChain } = createSupabaseMock({
      cartResult: {
        data: {
          agent_id: 'openai-agent',
          buyer: {},
          cart_id: 'cart_123',
          cart_items: [{ id: 'product-1', quantity: 1 }],
          checkout_session_id: null,
          currency: 'NGN',
          id: 'row-1',
          merchant_id: 'merchant-1',
          metadata: {},
          migrated_to_cart_id: 'canonical-1',
          shipping_address: null,
          status: 'active',
        },
        error: null,
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/carts/cart_123', {
        body: JSON.stringify({
          line_items: [{ item: { id: 'product-2' }, quantity: 2 }],
        }),
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'cart_123' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      cart_id: 'canonical-1',
      code: 'refresh_required',
    });
    expect(updateChain.update).not.toHaveBeenCalled();
  });

  it('hides carts owned by a different platform caller', async () => {
    mockMutation({
      line_items: [{ item: { id: 'product-2' }, quantity: 2 }],
    });
    createSupabaseMock({
      cartResult: {
        data: {
          agent_id: 'other-agent',
          buyer: {},
          cart_id: 'cart_123',
          cart_items: [{ id: 'product-1', quantity: 1 }],
          checkout_session_id: null,
          currency: 'NGN',
          id: 'row-1',
          merchant_id: 'merchant-1',
          metadata: {},
          shipping_address: null,
          status: 'active',
        },
        error: null,
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/carts/cart_123', {
        body: JSON.stringify({
          line_items: [{ item: { id: 'product-2' }, quantity: 2 }],
        }),
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'cart_123' }) }
    );

    expect(response.status).toBe(404);
  });

  it('answers a version conflict when a concurrent replacement wins', async () => {
    mockMutation({
      line_items: [{ item: { id: 'product-2' }, quantity: 2 }],
    });
    mockCalculation(2, 'product-2');
    createSupabaseMock({
      cartResult: {
        data: {
          agent_id: 'openai-agent',
          buyer: {},
          cart_id: 'cart_123',
          cart_items: [{ id: 'product-1', quantity: 1 }],
          checkout_session_id: null,
          currency: 'NGN',
          id: 'row-1',
          merchant_id: 'merchant-1',
          metadata: {},
          shipping_address: null,
          status: 'active',
          updated_at: '2026-10-14T00:00:00.000Z',
        },
        error: null,
      },
      updateResult: { data: null, error: null },
    });

    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/carts/cart_123', {
        body: JSON.stringify({
          line_items: [{ item: { id: 'product-2' }, quantity: 2 }],
        }),
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'cart_123' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ code: 'version_conflict' });
  });

  it('rejects updates after a cart is converted', async () => {
    mockMutation({
      line_items: [{ item: { id: 'product-2' }, quantity: 2 }],
    });
    createSupabaseMock({
      cartResult: {
        data: {
          agent_id: 'openai-agent',
          cart_id: 'cart_123',
          cart_items: [{ id: 'product-1', quantity: 1 }],
          currency: 'NGN',
          status: 'converted',
        },
        error: null,
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/carts/cart_123', {
        body: JSON.stringify({
          line_items: [{ item: { id: 'product-2' }, quantity: 2 }],
        }),
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'cart_123' }) }
    );

    expect(response.status).toBe(409);
  });
});
