import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/agentic/checkout_sessions/[id]/complete/route';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import {
  reserveAgenticIdempotencyKey,
  storeAgenticIdempotencyResponse,
} from '@/lib/agentic/idempotency';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { createAdminClient } from '@/lib/supabase/admin';

const mockResolveAgenticMerchantContext = vi.hoisted(() => vi.fn());

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
  isAgenticMerchantCheckoutEnabled: (merchant: {
    agentic_checkout_enabled?: boolean;
  }) => merchant.agentic_checkout_enabled !== false,
  resolveAgenticMerchantContextFromRpc: mockResolveAgenticMerchantContext,
}));

vi.mock('@/lib/agentic/mutation-request', () => ({
  readAgenticMutationRequest: vi.fn(() =>
    Promise.resolve({
      apiVersion: '2026-04-30',
      body: {
        buyer: {
          email: 'buyer@example.com',
          first_name: 'Ada',
          last_name: 'Lovelace',
          phone_number: '+2348012345678',
        },
        payment_data: { provider: 'paystack', token: 'confirmed-by-human' },
      },
      idempotencyKey: 'idem-1',
      method: 'POST',
      ok: true,
      pathname: '/api/agentic/checkout_sessions/agentic_session_1/complete',
      rawBody: '{}',
      requestId: 'req_123',
    })
  ),
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

describe('POST /api/agentic/checkout_sessions/[id]/complete database errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAgenticMerchantContext.mockResolvedValue({
      id: 'merchant-1',
      paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
      slug: 'ogabassey',
    });
    vi.mocked(reserveAgenticRequestId).mockResolvedValue({ ok: true });
    vi.mocked(reserveAgenticIdempotencyKey).mockResolvedValue({
      ok: true,
      state: 'reserved',
    });
    vi.mocked(storeAgenticIdempotencyResponse).mockResolvedValue({
      error: null,
      ok: true,
    });
  });

  it('returns 500 when the session read fails', async () => {
    const readChain = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'database unavailable' },
      }),
    };
    readChain.eq.mockReturnValue(readChain);
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== 'checkout_sessions') {
          throw new Error(`Unexpected table ${table}`);
        }
        return { select: vi.fn(() => readChain) };
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue(supabase as never);
    vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
      supabase as never
    );

    const response = await POST(
      new NextRequest(
        'http://localhost/api/agentic/checkout_sessions/agentic_session_1/complete',
        { method: 'POST' }
      ),
      { params: Promise.resolve({ id: 'agentic_session_1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Database error' });
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'idem-1',
        response: { error: 'Database error' },
        route: 'checkout_sessions.complete',
        status: 500,
      })
    );
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when the stored cart items are malformed', async () => {
    const readChain = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'row-1',
          session_id: 'agentic_session_1',
          merchant_id: 'merchant-1',
          cart_items: [{ id: '', quantity: 0 }],
          shipping_method: 'pickup_store_1',
          shipping_address: { city: 'Lagos' },
          currency: 'NGN',
          status: 'processing',
          order_id: null,
          payment_reference: null,
          virtual_account_bank: null,
          virtual_account_name: null,
          virtual_account_number: null,
          metadata: null,
        },
        error: null,
      }),
    };
    readChain.eq.mockReturnValue(readChain);
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== 'checkout_sessions') {
          throw new Error(`Unexpected table ${table}`);
        }
        return { select: vi.fn(() => readChain) };
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue(supabase as never);
    vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
      supabase as never
    );

    const response = await POST(
      new NextRequest(
        'http://localhost/api/agentic/checkout_sessions/agentic_session_1/complete',
        { method: 'POST' }
      ),
      { params: Promise.resolve({ id: 'agentic_session_1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Invalid session cart items' });
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'idem-1',
        response: { error: 'Invalid session cart items' },
        route: 'checkout_sessions.complete',
        status: 500,
      })
    );
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when the final checkout calculation has item errors', async () => {
    const readChain = {
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'row-1',
          session_id: 'agentic_session_1',
          merchant_id: 'merchant-1',
          cart_items: [{ id: 'product-1', quantity: 1 }],
          shipping_method: 'pickup_store_1',
          shipping_address: { city: 'Lagos' },
          currency: 'NGN',
          status: 'processing',
          order_id: null,
          payment_reference: null,
          virtual_account_bank: null,
          virtual_account_name: null,
          virtual_account_number: null,
          metadata: null,
        },
        error: null,
      }),
    };
    readChain.eq.mockReturnValue(readChain);
    const supabase = {
      from: vi.fn((table: string) => {
        if (table !== 'checkout_sessions') {
          throw new Error(`Unexpected table ${table}`);
        }
        return { select: vi.fn(() => readChain) };
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue(supabase as never);
    vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
      supabase as never
    );
    vi.mocked(calculateCheckoutSession).mockResolvedValue({
      fulfillmentOptions: [],
      lineItems: [
        {
          base_amount: 1000,
          discount: 0,
          id: 'line_product-1',
          item: {
            id: 'product-1',
            product_id: 'product-1',
            quantity: 1,
            title: 'Phone',
          },
          subtotal: 1000,
          tax: 0,
          total: 1000,
        },
      ],
      messages: [
        {
          code: 'out_of_stock',
          content: 'Only 0 items available for Phone.',
          content_type: 'plain',
          path: '$.items[0]',
          type: 'error',
        },
      ],
      selectedOptionId: 'pickup_store_1',
      totals: [{ amount: 1000, display_text: 'Total', type: 'total' }],
    });

    const response = await POST(
      new NextRequest(
        'http://localhost/api/agentic/checkout_sessions/agentic_session_1/complete',
        { method: 'POST' }
      ),
      { params: Promise.resolve({ id: 'agentic_session_1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: 'Checkout calculation has errors',
      messages: [expect.objectContaining({ code: 'out_of_stock' })],
    });
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'idem-1',
        response: expect.objectContaining({
          error: 'Checkout calculation has errors',
          messages: [expect.objectContaining({ code: 'out_of_stock' })],
        }),
        route: 'checkout_sessions.complete',
        status: 409,
      })
    );
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledTimes(1);
  });
});
