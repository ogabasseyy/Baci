import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAgenticMutationRequest } from '@/lib/agentic/mutation-request';
import { convertUcpCartToCheckout } from '@/lib/agentic/ucp-cart-checkout-conversion';

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
const mockConvertUcpCartToCheckout = vi.hoisted(() =>
  vi.fn(async () => NextResponse.json({ id: 'agentic_session_1' }))
);

vi.mock('@/lib/agentic/auth', () => ({
  verifyAgenticApiKey: mockVerifyAgenticApiKey,
}));

vi.mock('@/lib/agentic/agent-request-controls', () => ({
  verifyAgenticRequestAccess: vi.fn(() => ({ ok: true })),
}));

vi.mock('@/lib/agentic/merchant-context', () => ({
  resolveAgenticMerchantContextFromRpc: mockResolveAgenticMerchantContext,
}));

vi.mock('@/lib/agentic/mutation-request', () => ({
  readAgenticMutationRequest: vi.fn(),
}));

vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticScopedSupabaseClient: vi.fn(() => ({ from: vi.fn() })),
}));

vi.mock('@/lib/agentic/ucp-cart-checkout-conversion', () => ({
  convertUcpCartToCheckout: mockConvertUcpCartToCheckout,
}));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: vi.fn(() => ({})),
}));

function mockMutation() {
  vi.mocked(readAgenticMutationRequest).mockResolvedValue({
    agentId: 'openai-agent',
    apiVersion: '2026-04-30',
    body: {},
    idempotencyKey: 'idem-1',
    method: 'POST',
    ok: true,
    pathname: '/api/agentic/carts/cart_123/checkout',
    rawBody: '{}',
    requestId: 'req-1',
  });
}

describe('POST /api/agentic/carts/[id]/checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyAgenticApiKey.mockReturnValue(true);
  });

  it('returns 401 when the agent key is missing', async () => {
    mockVerifyAgenticApiKey.mockReturnValue(false);

    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/carts/cart_123/checkout', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'cart_123' }) }
    );

    expect(response.status).toBe(401);
    expect(convertUcpCartToCheckout).not.toHaveBeenCalled();
  });

  it('delegates active cart conversion to the conversion helper', async () => {
    mockMutation();

    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/carts/cart_123/checkout', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'cart_123' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('agentic_session_1');
  });
});
