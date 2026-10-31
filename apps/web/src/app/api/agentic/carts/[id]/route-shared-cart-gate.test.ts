import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reserveAgenticIdempotencyKey } from '@/lib/agentic/idempotency';
import {
  readAgenticMutationRequest,
  readAgenticQueryRequest,
} from '@/lib/agentic/mutation-request';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { handleCanonicalUcpCart } from '@/lib/agentic/ucp-canonical-cart';
import { POST as cancelCart } from './cancel/route';
import { POST as convertCart } from './checkout/route';
import { GET, POST } from './route';

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
  resolveAgenticMerchantContextFromRpc: mockResolveAgenticMerchantContext,
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

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: vi.fn(() => ({})),
}));

vi.mock('@/lib/agentic/ucp-cart-checkout-conversion', () => ({
  convertUcpCartToCheckout: vi.fn(),
}));

vi.mock('@/lib/agentic/is-ucp-shared-cart-enabled', () => ({
  isUcpSharedCartEnabled: vi.fn(async () => false),
}));

const props = { params: Promise.resolve({ id: 'cart_123' }) };
const url = 'http://localhost/api/agentic/carts/cart_123';
// The update route rejects an empty body before it reaches the gate, so this
// is the valid update body used by route-update.test.ts.
const body = { buyer: { email: 'new@example.com' } };
const mutation = {
  agentId: 'openai-agent',
  apiVersion: '2026-04-30',
  body,
  idempotencyKey: 'idem-1',
  method: 'POST',
  ok: true as const,
  pathname: '/api/agentic/carts/cart_123',
  rawBody: JSON.stringify(body),
  requestId: 'req-1',
};

async function expectGated(response: Response) {
  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toMatchObject({
    code: 'cart_unavailable',
  });
  expect(reserveAgenticIdempotencyKey).not.toHaveBeenCalled();
  expect(reserveAgenticRequestId).not.toHaveBeenCalled();
  expect(createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
  expect(handleCanonicalUcpCart).not.toHaveBeenCalled();
}

describe('per-cart routes shared-cart gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAgenticMutationRequest).mockResolvedValue(mutation as never);
    vi.mocked(readAgenticQueryRequest).mockResolvedValue({
      agentId: 'openai-agent',
      ok: true,
    } as never);
  });

  it('fails a cart read closed', async () => {
    await expectGated(await GET(new NextRequest(url), props));
  });

  it('fails a cart update closed before reserving keys', async () => {
    await expectGated(
      await POST(new NextRequest(url, { method: 'POST' }), props)
    );
  });

  it('fails a cart cancel closed before reserving keys', async () => {
    await expectGated(
      await cancelCart(
        new NextRequest(`${url}/cancel`, { method: 'POST' }),
        props
      )
    );
  });

  it('fails a cart-to-checkout conversion closed', async () => {
    await expectGated(
      await convertCart(
        new NextRequest(`${url}/checkout`, { method: 'POST' }),
        props
      )
    );
  });
});
