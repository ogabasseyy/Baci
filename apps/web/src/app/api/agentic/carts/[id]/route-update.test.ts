import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import {
  reserveAgenticIdempotencyKey,
  storeAgenticIdempotencyResponse,
} from '@/lib/agentic/idempotency';
import { readAgenticMutationRequest } from '@/lib/agentic/mutation-request';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { handleCanonicalUcpCart } from '@/lib/agentic/ucp-canonical-cart';

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

vi.mock('@/lib/agentic/ucp-canonical-cart', () => ({
  handleCanonicalUcpCart: vi.fn().mockResolvedValue(null),
}));

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
    if (table === 'product_variants') {
      return {
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: [], error: null })),
          })),
        })),
      };
    }
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

describe('/api/agentic/carts/[id] update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(handleCanonicalUcpCart).mockResolvedValue(null);
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

  it('preserves stored lines on a metadata-only update', async () => {
    mockMutation({ buyer: { email: 'new@example.com' } });
    mockCalculation();
    const { updateChain } = createSupabaseMock({
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
        body: JSON.stringify({ buyer: { email: 'new@example.com' } }),
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'cart_123' }) }
    );
    expect(response.status).toBe(200);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ cart_items: expect.anything() })
    );
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
});
