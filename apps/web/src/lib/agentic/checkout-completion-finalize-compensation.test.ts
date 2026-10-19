import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeAgenticCheckoutPayment } from '@/lib/agentic/checkout-completion-finalize';
import {
  createAgenticCheckoutOrder,
  markAgenticCheckoutOrderCanceled,
  sendAgenticOrderCreatedWebhook,
} from '@/lib/agentic/checkout-order-dispatch';
import { buildOrderFinalizationClaim } from '@/lib/agentic/checkout-order-finalization-claim';
import { storeAgenticIdempotencyResponse } from '@/lib/agentic/idempotency';

vi.mock('@/lib/agentic/checkout-order-dispatch', () => ({
  createAgenticCheckoutOrder: vi.fn(),
  markAgenticCheckoutOrderCanceled: vi.fn(),
  sendAgenticOrderCreatedWebhook: vi.fn(),
}));

vi.mock('@/lib/agentic/idempotency', () => ({
  storeAgenticIdempotencyResponse: vi.fn(),
}));

function createUpdateChain(
  data: Record<string, unknown> | null,
  error: unknown = null
) {
  const chain = {
    contains: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    select: vi.fn(),
  };
  chain.contains.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  chain.select.mockReturnValue({
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  });

  return chain;
}

function createSupabaseWithUpdateChains(
  chains: ReturnType<typeof createUpdateChain>[]
) {
  const update = vi.fn(() => {
    const chain = chains.shift();
    if (!chain) {
      throw new Error('Unexpected checkout_sessions update');
    }
    return chain;
  });

  return {
    from: vi.fn((table: string) => {
      if (table === 'orders') {
        // Finalization verifies the live order state for every
        // session: freshly created fixture orders await payment.
        const chain = {
          select: vi.fn(),
          eq: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { payment_status: 'unpaid', shipping_status: 'pending' },
            error: null,
          }),
        };
        chain.select.mockReturnValue(chain);
        chain.eq.mockReturnValue(chain);
        return chain;
      }
      if (table !== 'checkout_sessions') {
        throw new Error(`Unexpected table ${table}`);
      }
      return { update };
    }),
    update,
  };
}

function finalizeInput(supabase: unknown) {
  return {
    buyer: {
      email: 'buyer@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      phone_number: '+2348012345678',
    },
    dvaAccount: {
      account_name: 'Ada Lovelace',
      account_number: '1234567890',
      bank_name: 'Paystack-Titan',
    },
    idempotencyKey: 'idem-1',
    merchantId: 'merchant-1',
    metadata: { agentic: { payment_state: 'payment_account_ready' } },
    orderSession: {
      currency: 'NGN',
      merchant_id: 'merchant-1',
      session_id: 'agentic_session_1',
      shipping_address: { city: 'Lagos' },
    },
    orderSessionCalc: {
      fulfillmentOptions: [],
      lineItems: [],
      messages: [],
      selectedOptionId: 'pickup_store_1',
      totals: [{ type: 'total' as const, display_text: 'Total', amount: 0 }],
    },
    requestId: 'req_123',
    route: 'checkout_sessions.complete',
    sessionId: 'agentic_session_1',
    supabase: supabase as never,
  };
}

function createPostgrestError(message: string) {
  return Object.assign(new Error(message), {
    code: 'PGRST000',
    details: '',
    hint: '',
    name: 'PostgrestError',
    toJSON: () => ({
      code: 'PGRST000',
      details: '',
      hint: '',
      message,
      name: 'PostgrestError',
    }),
  });
}

describe('finalizeAgenticCheckoutPayment compensation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storeAgenticIdempotencyResponse).mockResolvedValue({
      error: null,
      ok: true,
    });
  });

  it('does not release the finalization claim when compensating order cancellation fails', async () => {
    const claimChain = createUpdateChain({ session_id: 'agentic_session_1' });
    // Marker write records the created order before final session persistence.
    const markerChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const finalChain = createUpdateChain(null, { message: 'update failed' });
    const releaseChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const supabase = createSupabaseWithUpdateChains([
      claimChain,
      markerChain,
      finalChain,
      releaseChain,
    ]);
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: { order: { id: 'order-1' } },
      error: undefined,
      ok: true,
      orderId: 'order-1',
      status: 201,
      statusText: 'Created',
    });
    vi.mocked(markAgenticCheckoutOrderCanceled).mockResolvedValueOnce({
      error: createPostgrestError('cancel failed'),
      updated: false,
    });

    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Database error' });
    expect(markAgenticCheckoutOrderCanceled).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        sessionId: 'agentic_session_1',
      })
    );
    expect(markerChain.contains).toHaveBeenCalledWith('metadata', {
      agentic: {
        finalization_claim: buildOrderFinalizationClaim({
          idempotencyKey: 'idem-1',
          requestId: 'req_123',
          sessionId: 'agentic_session_1',
        }),
        payment_state: 'order_finalizing',
      },
    });
    expect(releaseChain.contains).not.toHaveBeenCalled();
    expect(sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
  });

  it('returns 503 when compensation completes but idempotency storage fails', async () => {
    const claimChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const markerChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const finalChain = createUpdateChain(null, { message: 'update failed' });
    const releaseChain = createUpdateChain({ session_id: 'agentic_session_1' });
    const supabase = createSupabaseWithUpdateChains([
      claimChain,
      markerChain,
      finalChain,
      releaseChain,
    ]);
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: { order: { id: 'order-1' } },
      error: undefined,
      ok: true,
      orderId: 'order-1',
      status: 201,
      statusText: 'Created',
    });
    vi.mocked(markAgenticCheckoutOrderCanceled).mockResolvedValueOnce({
      error: null,
      updated: true,
    });
    vi.mocked(storeAgenticIdempotencyResponse).mockResolvedValueOnce({
      error: new Error('store failed'),
      ok: false,
    });

    const response = await finalizeAgenticCheckoutPayment(
      finalizeInput(supabase)
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'Idempotency response storage failed' });
    expect(markAgenticCheckoutOrderCanceled).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        orderId: 'order-1',
        sessionId: 'agentic_session_1',
      })
    );
    expect(releaseChain.contains).toHaveBeenCalled();
    expect(sendAgenticOrderCreatedWebhook).not.toHaveBeenCalled();
  });
});
