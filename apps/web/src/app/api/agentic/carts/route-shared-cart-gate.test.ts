import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reserveAgenticIdempotencyKey } from '@/lib/agentic/idempotency';
import { readAgenticMutationRequest } from '@/lib/agentic/mutation-request';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { handleCanonicalUcpCart } from '@/lib/agentic/ucp-canonical-cart';
import { POST } from './route';

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
  AGENTIC_CHECKOUT_DISABLED_ERROR: 'Agentic checkout disabled',
  isAgenticMerchantCheckoutEnabled: (merchant: {
    agentic_checkout_enabled?: boolean;
  }) => merchant.agentic_checkout_enabled !== false,
  resolveAgenticMerchantContextFromRpc: mockResolveAgenticMerchantContext,
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

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: vi.fn(() => ({})),
}));

function mockMutation(body: unknown) {
  vi.mocked(readAgenticMutationRequest).mockResolvedValue({
    agentId: 'openai-agent',
    apiVersion: '2026-04-30',
    body,
    idempotencyKey: 'idem-1',
    method: 'POST',
    ok: true,
    pathname: '/api/agentic/carts',
    rawBody: JSON.stringify(body),
    requestId: 'req-1',
  });
}

vi.mock('@/lib/agentic/is-ucp-shared-cart-enabled', () => ({
  isUcpSharedCartEnabled: vi.fn(async () => false),
}));

describe('POST /api/agentic/carts shared-cart gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutation({
      currency: 'NGN',
      line_items: [{ item: { id: 'product-1' }, quantity: 1 }],
    });
  });

  it('fails closed before reserving keys or writing a cart', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/carts', { method: 'POST' })
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 'cart_unavailable',
    });
    expect(reserveAgenticIdempotencyKey).not.toHaveBeenCalled();
    expect(reserveAgenticRequestId).not.toHaveBeenCalled();
    expect(createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
    expect(handleCanonicalUcpCart).not.toHaveBeenCalled();
  });
});
