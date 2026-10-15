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
  return { updateChain };
}

function mockMutation() {
  vi.mocked(readAgenticMutationRequest).mockResolvedValue({
    agentId: 'openai-agent',
    apiVersion: '2026-04-30',
    body: {},
    idempotencyKey: 'idem-1',
    method: 'POST',
    ok: true,
    pathname: '/api/agentic/carts/cart_123/cancel',
    rawBody: '{}',
    requestId: 'req-1',
  });
}

function mockCalculation() {
  vi.mocked(calculateCheckoutSession).mockResolvedValue({
    fulfillmentOptions: [],
    lineItems: [],
    messages: [],
    selectedOptionId: undefined,
    totals: [{ amount: 0, display_text: 'Total', type: 'total' }],
  });
}

describe('POST /api/agentic/carts/[id]/cancel', () => {
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

  it('cancels an active cart', async () => {
    mockMutation();
    mockCalculation();
    const { updateChain } = createSupabaseMock({
      cartResult: {
        data: {
          agent_id: 'openai-agent',
          cart_id: 'cart_123',
          cart_items: [{ id: 'product-1', quantity: 1 }],
          currency: 'NGN',
          status: 'active',
        },
        error: null,
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/carts/cart_123/cancel', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'cart_123' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('canceled');
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'canceled' })
    );
  });

  it('returns 409 for converted carts', async () => {
    mockMutation();
    createSupabaseMock({
      cartResult: {
        data: {
          agent_id: 'openai-agent',
          cart_id: 'cart_123',
          currency: 'NGN',
          status: 'converted',
        },
        error: null,
      },
    });

    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/carts/cart_123/cancel', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'cart_123' }) }
    );

    expect(response.status).toBe(409);
  });
});
