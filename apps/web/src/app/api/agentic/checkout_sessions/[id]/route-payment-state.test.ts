import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import {
  reserveAgenticIdempotencyKey,
  storeAgenticIdempotencyResponse,
} from '@/lib/agentic/idempotency';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { createAdminClient } from '@/lib/supabase/admin';

const mockVerifyAgenticApiKey = vi.fn(() => true);
type MockAgenticMerchantContext = {
  agentic_checkout_enabled?: boolean;
  id: string;
  slug: string;
};

const mockResolveAgenticMerchantContext = vi.fn<
  () => Promise<MockAgenticMerchantContext | null>
>(() => Promise.resolve({ id: 'merchant-1', slug: 'ogabassey' }));

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

vi.mock('@/lib/agentic/checkout', () => ({
  calculateCheckoutSession: vi.fn(),
}));

vi.mock('@/lib/agentic/idempotency', () => ({
  reserveAgenticIdempotencyKey: vi.fn(),
  storeAgenticIdempotencyResponse: vi.fn(),
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

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

const { POST } = await import('./route');

describe('POST /api/agentic/checkout_sessions/[id] payment state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyAgenticApiKey.mockReturnValue(true);
    mockResolveAgenticMerchantContext.mockResolvedValue({
      id: 'merchant-1',
      slug: 'ogabassey',
    });
    vi.mocked(reserveAgenticIdempotencyKey).mockResolvedValue({
      ok: true,
      state: 'reserved',
    });
    vi.mocked(storeAgenticIdempotencyResponse).mockResolvedValue({
      error: null,
      ok: true,
    });
    vi.mocked(reserveAgenticRequestId).mockResolvedValue({ ok: true });
  });

  it('returns 403 when the merchant disables agentic checkout', async () => {
    mockResolveAgenticMerchantContext.mockResolvedValueOnce({
      agentic_checkout_enabled: false,
      id: 'merchant-1',
      slug: 'ogabassey',
    });
    vi.mocked(createAdminClient).mockReturnValue({} as never);

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/agentic_session_1',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-1',
        },
        body: JSON.stringify({
          shipping_address: { city: 'Abuja' },
        }),
      }
    );

    const response = await POST(request, {
      params: Promise.resolve({ id: 'agentic_session_1' }),
    });
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

  it('rejects updates after payment setup has started', async () => {
    const updateSpy = vi.fn();

    const readChain = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'session-1',
          session_id: 'agentic_session_1',
          status: 'processing',
          cart_items: [{ id: 'product-1', quantity: 1 }],
          currency: 'NGN',
          shipping_method: 'pickup_store_1',
          shipping_address: { city: 'Lagos' },
          order_id: null,
          payment_reference: null,
          virtual_account_number: null,
          metadata: {
            agentic: { payment_state: 'payment_pending' },
          },
        },
        error: null,
      }),
    };
    readChain.eq.mockReturnValue(readChain);

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'checkout_sessions') {
          return {
            select: vi.fn(() => readChain),
            update: updateSpy,
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => {
        throw new Error('Admin client should not read checkout_sessions');
      }),
    } as never);
    vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
      supabase as never
    );

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/agentic_session_1',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-1',
        },
        body: JSON.stringify({
          shipping_address: { city: 'Abuja' },
        }),
      }
    );
    const params = { params: Promise.resolve({ id: 'agentic_session_1' }) };

    const response = await POST(request, params);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: 'Session already has pending payment',
      status: 'payment_pending',
    });
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'idem-1',
        response: {
          error: 'Session already has pending payment',
          status: 'payment_pending',
        },
        route: 'checkout_sessions.update',
        status: 409,
      })
    );
    expect(updateSpy).not.toHaveBeenCalled();
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('updates mutable sessions and stores the successful idempotency response', async () => {
    const readChain = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'session-1',
          session_id: 'agentic_session_1',
          status: 'pending',
          cart_items: [{ id: 'product-1', quantity: 1 }],
          currency: 'NGN',
          shipping_method: null,
          shipping_address: null,
          order_id: null,
          payment_reference: null,
          virtual_account_number: null,
          metadata: { agentic: {} },
        },
        error: null,
      }),
    };
    readChain.eq.mockReturnValue(readChain);
    const updateChain = {
      eq: vi.fn(),
      in: vi.fn(),
      is: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { session_id: 'agentic_session_1' },
        error: null,
      }),
      select: vi.fn(),
    };
    updateChain.eq.mockReturnValue(updateChain);
    updateChain.in.mockReturnValue(updateChain);
    updateChain.is.mockReturnValue(updateChain);
    updateChain.select.mockReturnValue(updateChain);
    const updateSpy = vi.fn(() => updateChain);
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'checkout_sessions') {
          return {
            select: vi.fn(() => readChain),
            update: updateSpy,
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue({
      from: vi.fn(() => {
        throw new Error('Admin client should not read checkout_sessions');
      }),
    } as never);
    vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
      supabase as never
    );
    vi.mocked(calculateCheckoutSession).mockResolvedValue({
      fulfillmentOptions: [],
      lineItems: [
        {
          id: 'line_item_1',
          item: {
            id: 'product-1',
            product_id: 'product-1',
            quantity: 1,
            title: 'Phone',
          },
          base_amount: 500000,
          discount: 0,
          subtotal: 500000,
          tax: 0,
          total: 500000,
        },
      ],
      messages: [],
      selectedOptionId: undefined,
      totals: [{ type: 'total', display_text: 'Total', amount: 500000 }],
    });

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/agentic_session_1',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-1',
        },
        body: JSON.stringify({
          items: [{ id: 'product-1', quantity: 1 }],
        }),
      }
    );

    const response = await POST(request, {
      params: Promise.resolve({ id: 'agentic_session_1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('not_ready_for_payment');
    expect(updateSpy).toHaveBeenCalled();
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'idem-1',
        route: 'checkout_sessions.update',
        status: 200,
      })
    );
  });
});
