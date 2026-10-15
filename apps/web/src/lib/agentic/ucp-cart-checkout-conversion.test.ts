import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import {
  reserveAgenticIdempotencyKey,
  storeAgenticIdempotencyResponse,
} from '@/lib/agentic/idempotency';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { convertUcpCartToCheckout } from '@/lib/agentic/ucp-cart-checkout-conversion';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/agentic/checkout', () => ({
  calculateCheckoutSession: vi.fn(),
}));

vi.mock('@/lib/agentic/idempotency', () => ({
  reserveAgenticIdempotencyKey: vi.fn(),
  storeAgenticIdempotencyResponse: vi.fn(),
}));

vi.mock('@/lib/agentic/request-replay', () => ({
  reserveAgenticRequestId: vi.fn(),
}));

const merchant = {
  agent_user_agent_allowlist: [],
  agent_user_agent_denylist: [],
  agentic_checkout_enabled: true,
  business_name: 'Ogabassey',
  custom_domain: undefined,
  id: 'merchant-1',
  pay_on_delivery_enabled: false,
  paystack_subaccount_code: null,
  slug: 'ogabassey',
};

const mutation = {
  agentId: 'openai-agent',
  apiVersion: '2026-04-30',
  body: {},
  idempotencyKey: 'idem-1',
  method: 'POST',
  ok: true as const,
  pathname: '/api/agentic/carts/cart_123/checkout',
  rawBody: '{}',
  requestId: 'req-1',
};

function createChain(result: { data: unknown; error: unknown }) {
  const chain = {
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue(result),
    select: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue(result),
    update: vi.fn(() => chain),
  };
  return chain;
}

function createSupabaseMock({
  cartResult,
  checkoutInsertResult = {
    data: { id: 'checkout-row-1', session_id: 'agentic_session_1' },
    error: null,
  },
  checkoutSelectResult = { data: null, error: null },
  cartUpdateResult = { data: { cart_id: 'cart_123' }, error: null },
}: {
  cartResult: { data: unknown; error: unknown };
  checkoutInsertResult?: { data: unknown; error: unknown };
  checkoutSelectResult?: { data: unknown; error: unknown };
  cartUpdateResult?: { data: unknown; error: unknown };
}) {
  const cartSelectChain = createChain(cartResult);
  const cartUpdateChain = createChain(cartUpdateResult);
  const checkoutDeleteChain = createChain({ data: null, error: null });
  const checkoutInsertChain = createChain(checkoutInsertResult);
  const checkoutSelectChain = createChain(checkoutSelectResult);
  const from = vi.fn((table: string) => {
    if (table === 'agentic_cart_sessions') {
      return {
        select: cartSelectChain.select,
        update: cartUpdateChain.update,
      };
    }
    if (table === 'checkout_sessions') {
      return {
        delete: checkoutDeleteChain.delete,
        insert: checkoutInsertChain.insert,
        select: checkoutSelectChain.select,
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });

  return { cartUpdateChain, checkoutDeleteChain, checkoutInsertChain, from };
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

describe('convertUcpCartToCheckout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('creates a checkout session from an active cart and links the cart row', async () => {
    mockCalculation();
    const { cartUpdateChain, checkoutInsertChain, from } = createSupabaseMock({
      cartResult: {
        data: {
          agent_id: 'openai-agent',
          cart_id: 'cart_123',
          cart_items: [{ id: 'product-1', quantity: 1 }],
          checkout_session_id: null,
          currency: 'NGN',
          shipping_address: { city: 'Lagos' },
          status: 'active',
        },
        error: null,
      },
    });

    const response = await convertUcpCartToCheckout({
      cartId: 'cart_123',
      merchant,
      mutation,
      requestUrl: 'http://localhost/api/agentic/carts/cart_123/checkout',
      supabase: { from } as never,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('agentic_session_1');
    expect(checkoutInsertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        cart_items: [{ id: 'product-1', quantity: 1 }],
        merchant_id: 'merchant-1',
      })
    );
    expect(cartUpdateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        checkout_session_id: 'checkout-row-1',
        status: 'converted',
      })
    );
  });

  it('hides a cart owned by another agent and scopes its receipt', async () => {
    const { from } = createSupabaseMock({
      cartResult: {
        data: {
          agent_id: 'other-agent',
          cart_id: 'cart_123',
          currency: 'NGN',
          status: 'active',
        },
        error: null,
      },
    });

    const response = await convertUcpCartToCheckout({
      cartId: 'cart_123',
      merchant,
      mutation,
      requestUrl: 'http://localhost/api/agentic/carts/cart_123/checkout',
      supabase: { from } as never,
    });

    expect(response.status).toBe(404);
    expect(reserveAgenticIdempotencyKey).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'openai-agent' })
    );
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'openai-agent' })
    );
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('returns 409 when the cart is canceled', async () => {
    const { from } = createSupabaseMock({
      cartResult: {
        data: {
          agent_id: 'openai-agent',
          cart_id: 'cart_123',
          currency: 'NGN',
          status: 'canceled',
        },
        error: null,
      },
    });

    const response = await convertUcpCartToCheckout({
      cartId: 'cart_123',
      merchant,
      mutation,
      requestUrl: 'http://localhost/api/agentic/carts/cart_123/checkout',
      supabase: { from } as never,
    });

    expect(response.status).toBe(409);
  });

  it('deletes the checkout session when cart link update fails', async () => {
    mockCalculation();
    const { checkoutDeleteChain, from } = createSupabaseMock({
      cartResult: {
        data: {
          agent_id: 'openai-agent',
          cart_id: 'cart_123',
          cart_items: [{ id: 'product-1', quantity: 1 }],
          checkout_session_id: null,
          currency: 'NGN',
          shipping_address: null,
          status: 'active',
        },
        error: null,
      },
      cartUpdateResult: { data: null, error: new Error('update failed') },
    });

    const response = await convertUcpCartToCheckout({
      cartId: 'cart_123',
      merchant,
      mutation,
      requestUrl: 'http://localhost/api/agentic/carts/cart_123/checkout',
      supabase: { from } as never,
    });

    expect(response.status).toBe(500);
    expect(checkoutDeleteChain.delete).toHaveBeenCalled();
    expect(checkoutDeleteChain.eq).toHaveBeenCalledWith('id', 'checkout-row-1');
    expect(checkoutDeleteChain.eq).toHaveBeenCalledWith(
      'merchant_id',
      'merchant-1'
    );
  });

  it('returns 409 refresh_required when the cart migrated to the shared cart', async () => {
    const { checkoutInsertChain, from } = createSupabaseMock({
      cartResult: {
        data: {
          agent_id: 'openai-agent',
          cart_id: 'cart_123',
          cart_items: [{ id: 'product-1', quantity: 1 }],
          checkout_session_id: null,
          currency: 'NGN',
          migrated_to_cart_id: 'cart-shared-1',
          status: 'active',
        },
        error: null,
      },
    });

    const response = await convertUcpCartToCheckout({
      cartId: 'cart_123',
      merchant,
      mutation,
      requestUrl: 'http://localhost/api/agentic/carts/cart_123/checkout',
      supabase: { from } as never,
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      cart_id: 'cart-shared-1',
      code: 'refresh_required',
    });
    // The retired row must not convert through the legacy path: no
    // checkout session, no cart link write.
    expect(checkoutInsertChain.insert).not.toHaveBeenCalled();
  });
});
