import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import {
  reserveAgenticIdempotencyKey,
  storeAgenticIdempotencyResponse,
} from '@/lib/agentic/idempotency';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';

const mocks = vi.hoisted(() => {
  const insert = vi.fn();
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'checkout_sessions') return { insert };
      throw new Error(`Unexpected table ${table}`);
    }),
  };

  return {
    createAdminClient: vi.fn(() => supabase),
    createAgenticScopedSupabaseClient: vi.fn(() => supabase),
    insert,
    resolveAgenticMerchantContext: vi.fn(),
    supabase,
  };
});

vi.mock('@/lib/agentic/auth', () => ({
  verifyAgenticApiKey: vi.fn(() => true),
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
  isAgenticMerchantCheckoutEnabled: () => true,
  resolveAgenticMerchantContext: mocks.resolveAgenticMerchantContext,
}));

vi.mock('@/lib/agentic/request-integrity', () => ({
  AGENTIC_REQUEST_INTEGRITY_ERRORS: {
    AGENT_ID_TOO_LONG: 'Agent ID too long',
    INVALID_AGENT_ID_FORMAT: 'Invalid agent ID format',
    INVALID_REQUEST_ID_FORMAT: 'Invalid request ID format',
    INVALID_TIMESTAMP: 'Invalid timestamp',
    MISSING_SIGNING_SECRET: 'Missing signing secret',
    REQUEST_ID_TOO_LONG: 'Request ID too long',
    STALE_TIMESTAMP: 'Stale timestamp',
    UNSUPPORTED_API_VERSION: 'Unsupported API version',
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
  createAgenticScopedSupabaseClient: mocks.createAgenticScopedSupabaseClient,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}));

describe('agentic checkout currency default', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveAgenticMerchantContext.mockResolvedValue({
      agent_user_agent_allowlist: [],
      agent_user_agent_denylist: [],
      agentic_checkout_enabled: true,
      id: 'merchant-1',
      pay_on_delivery_enabled: false,
      paystack_subaccount_code: null,
      slug: 'ogabassey',
    });
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

  it('defaults omitted currency to NGN for calculation, persistence, and response', async () => {
    mocks.insert.mockImplementation(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'row-1', session_id: 'agentic_session_1' },
          error: null,
        }),
      })),
    }));
    const mockSupabase = mocks.supabase;
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
      totals: [{ amount: 500000, display_text: 'Total Due', type: 'total' }],
    });

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions',
      {
        body: JSON.stringify({ items: [{ id: 'product-1', quantity: 1 }] }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-1',
        },
        method: 'POST',
      }
    );
    const { handleAgenticCheckoutSessionCreate } = await import(
      './checkout-session-create-handler'
    );

    const response = await handleAgenticCheckoutSessionCreate(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      currency: 'ngn',
      id: 'agentic_session_1',
    });
    expect(calculateCheckoutSession).toHaveBeenCalledWith(
      mockSupabase,
      [{ id: 'product-1', quantity: 1 }],
      null,
      'NGN',
      'merchant-1'
    );
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        cart_items: [{ id: 'product-1', quantity: 1 }],
        currency: 'NGN',
        merchant_id: 'merchant-1',
        session_id: expect.stringMatching(/^agentic_/),
      })
    );
  });
});
