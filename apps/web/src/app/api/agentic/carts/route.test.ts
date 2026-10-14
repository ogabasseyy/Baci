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
  AGENTIC_CHECKOUT_DISABLED_ERROR: 'Agentic checkout disabled',
  isAgenticMerchantCheckoutEnabled: (merchant: {
    agentic_checkout_enabled?: boolean;
  }) => merchant.agentic_checkout_enabled !== false,
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

function mockCalculation() {
  vi.mocked(calculateCheckoutSession).mockResolvedValue({
    fulfillmentOptions: [],
    lineItems: [
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
    messages: [],
    selectedOptionId: undefined,
    totals: [{ amount: 500000, display_text: 'Total', type: 'total' }],
  });
}

describe('POST /api/agentic/carts', () => {
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

  it('returns 400 for invalid cart bodies', async () => {
    mockMutation({ line_items: [] });

    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/carts', {
        body: JSON.stringify({ line_items: [] }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
    );

    expect(response.status).toBe(400);
    expect(createAgenticScopedSupabaseClient).not.toHaveBeenCalled();
  });

  it('creates a transfer cart even when native checkout is disabled', async () => {
    mockResolveAgenticMerchantContext.mockResolvedValueOnce({
      agent_user_agent_allowlist: [],
      agent_user_agent_denylist: [],
      agentic_checkout_enabled: false,
      business_name: 'Ogabassey',
      custom_domain: undefined,
      id: 'merchant-1',
      pay_on_delivery_enabled: false,
      paystack_subaccount_code: null,
      slug: 'ogabassey',
    });
    const insertSpy = vi.fn().mockReturnValue({ error: null });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== 'agentic_cart_sessions') {
          throw new Error(`Unexpected table ${table}`);
        }
        return { insert: insertSpy };
      }),
    };
    vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
      supabase as never
    );
    mockCalculation();
    mockMutation({
      currency: 'ngn',
      line_items: [{ item: { id: 'product-1' }, quantity: 1 }],
    });

    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/carts', {
        body: JSON.stringify({
          currency: 'ngn',
          line_items: [{ item: { id: 'product-1' }, quantity: 1 }],
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
    );

    expect(response.status).toBe(201);
    expect(insertSpy).toHaveBeenCalled();
  });

  it('creates a signed UCP cart session', async () => {
    const insertSpy = vi.fn().mockReturnValue({ error: null });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== 'agentic_cart_sessions') {
          throw new Error(`Unexpected table ${table}`);
        }
        return { insert: insertSpy };
      }),
    };
    vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
      supabase as never
    );
    mockCalculation();
    mockMutation({
      currency: 'ngn',
      line_items: [{ item: { id: 'product-1' }, quantity: 1 }],
    });

    const { POST } = await import('./route');
    const response = await POST(
      new NextRequest('http://localhost/api/agentic/carts', {
        body: JSON.stringify({
          currency: 'ngn',
          line_items: [{ item: { id: 'product-1' }, quantity: 1 }],
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      currency: 'NGN',
      id: expect.stringMatching(/^cart_/),
      status: 'active',
    });
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: 'openai-agent',
        cart_items: [{ id: 'product-1', quantity: 1 }],
        currency: 'NGN',
        merchant_id: 'merchant-1',
        status: 'active',
      })
    );
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'idem-1',
        route: 'carts.create',
        status: 201,
      })
    );
  });
});
