import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  GPTFulfillmentOption,
  GPTLineItem,
  GPTMessage,
  GPTTotal,
} from '@/lib/agentic/checkout';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import {
  reserveAgenticIdempotencyKey,
  storeAgenticIdempotencyResponse,
} from '@/lib/agentic/idempotency';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { adaptUcpCheckoutCreateRequestBody } from '@/lib/agentic/ucp-request-adapters';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/supabase/admin';

const mockGetIdempotencyKey = vi.fn(() => 'idem-1');
const mockConvertUcpCartToCheckout = vi.hoisted(() =>
  vi.fn(async () => new Response(JSON.stringify({ id: 'agentic_session_1' })))
);
type MockAgenticMerchantContext = {
  agent_user_agent_allowlist?: string[];
  agent_user_agent_denylist?: string[];
  agentic_checkout_enabled: boolean;
  id: string;
  pay_on_delivery_enabled: boolean;
  paystack_subaccount_code: string | null;
  slug: string;
};

const mockResolveAgenticMerchantContext = vi.fn<
  () => Promise<MockAgenticMerchantContext | null>
>(() =>
  Promise.resolve({
    agentic_checkout_enabled: true,
    id: 'merchant-1',
    pay_on_delivery_enabled: false,
    paystack_subaccount_code: null,
    slug: 'ogabassey',
  })
);
const mockVerifyAgenticApiKey = vi.fn(() => true);

type CheckoutCalculation = {
  fulfillmentOptions: GPTFulfillmentOption[];
  lineItems: GPTLineItem[];
  messages: GPTMessage[];
  selectedOptionId: string | undefined;
  totals: GPTTotal[];
};

function buildSuccessfulCheckoutCalculation(quantity = 1): CheckoutCalculation {
  const total = 500000 * quantity;
  return {
    fulfillmentOptions: [],
    lineItems: [
      {
        base_amount: total,
        discount: 0,
        id: 'line_product-1',
        item: {
          id: 'product-1',
          product_id: 'product-1',
          quantity,
          title: 'Phone',
        },
        subtotal: total,
        tax: 0,
        total,
      },
    ],
    messages: [],
    selectedOptionId: undefined,
    totals: [{ amount: total, display_text: 'Total Due', type: 'total' }],
  };
}

vi.mock('@/lib/agentic/auth', () => ({
  getIdempotencyKey: mockGetIdempotencyKey,
  verifyAgenticApiKey: mockVerifyAgenticApiKey,
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

vi.mock('@/lib/agentic/ucp-cart-checkout-conversion', () => ({
  convertUcpCartToCheckout: mockConvertUcpCartToCheckout,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}));

describe('POST /api/agentic/checkout_sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetIdempotencyKey.mockReturnValue('idem-1');
    mockResolveAgenticMerchantContext.mockResolvedValue({
      agentic_checkout_enabled: true,
      id: 'merchant-1',
      pay_on_delivery_enabled: false,
      paystack_subaccount_code: null,
      slug: 'ogabassey',
    });
    mockVerifyAgenticApiKey.mockReturnValue(true);
    vi.mocked(reserveAgenticIdempotencyKey).mockResolvedValue({
      ok: true,
      state: 'reserved',
    });
    vi.mocked(storeAgenticIdempotencyResponse).mockResolvedValue({
      ok: true,
      error: null,
    });
    vi.mocked(reserveAgenticRequestId).mockResolvedValue({ ok: true });
  });

  it('returns 400 when the request body cannot be parsed', async () => {
    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-1',
        },
        body: '{invalid-json',
      }
    );

    const { POST } = await import('./route');
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 401 when API key verification fails and skips downstream work', async () => {
    mockVerifyAgenticApiKey.mockReturnValue(false);

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: 'p-1', quantity: 1 }] }),
      }
    );

    const { POST } = await import('./route');
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Unauthorized' });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('returns 403 when the merchant disables agentic checkout', async () => {
    const mockSupabase = { from: vi.fn() };
    mockResolveAgenticMerchantContext.mockResolvedValue({
      agentic_checkout_enabled: false,
      id: 'merchant-1',
      pay_on_delivery_enabled: false,
      paystack_subaccount_code: null,
      slug: 'ogabassey',
    });
    vi.mocked(createAdminClient).mockReturnValue(mockSupabase as never);

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-1',
        },
        body: JSON.stringify({ items: [{ id: 'product-1', quantity: 1 }] }),
      }
    );

    const { POST } = await import('./route');
    const response = await POST(request);
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
        route: 'checkout_sessions.create',
        status: 403,
      })
    );
    expect(reserveAgenticRequestId).not.toHaveBeenCalled();
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('returns 403 when user-agent is not allowlisted for agentic requests', async () => {
    mockResolveAgenticMerchantContext.mockResolvedValue({
      agent_user_agent_allowlist: ['trusted-agent'],
      agentic_checkout_enabled: true,
      id: 'merchant-1',
      pay_on_delivery_enabled: false,
      paystack_subaccount_code: null,
      slug: 'ogabassey',
    });

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-1',
          'User-Agent': 'some-other-agent',
        },
        body: JSON.stringify({ items: [{ id: 'product-1', quantity: 1 }] }),
      }
    );

    const { POST } = await import('./route');
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Agent client not allowlisted' });
    expect(reserveAgenticIdempotencyKey).not.toHaveBeenCalled();
    expect(reserveAgenticRequestId).not.toHaveBeenCalled();
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('creates a checkout session from an ACP line_items payload without an adapter', async () => {
    const insertSpy = vi.fn((_: Record<string, unknown>) => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'row-1', session_id: 'agentic_session_1' },
          error: null,
        }),
      })),
    }));
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'checkout_sessions') {
          return {
            insert: insertSpy,
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    vi.mocked(createAdminClient).mockReturnValue(mockSupabase as never);
    vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
      mockSupabase as never
    );
    vi.mocked(calculateCheckoutSession).mockResolvedValue(
      buildSuccessfulCheckoutCalculation(2)
    );

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions',
      {
        body: JSON.stringify({
          capabilities: {},
          currency: 'ngn',
          line_items: [{ id: 'product-1', quantity: 2 }],
        }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-1',
        },
        method: 'POST',
      }
    );

    const { POST } = await import('./route');
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(calculateCheckoutSession).toHaveBeenCalledWith(
      mockSupabase,
      [{ id: 'product-1', quantity: 2 }],
      null,
      'NGN',
      'merchant-1'
    );
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        cart_items: [{ id: 'product-1', quantity: 2 }],
        currency: 'NGN',
      })
    );
  });

  it('delegates UCP cart references to the cart conversion flow', async () => {
    const mockSupabase = { from: vi.fn() };
    vi.mocked(createAdminClient).mockReturnValue(mockSupabase as never);
    vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
      mockSupabase as never
    );

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions',
      {
        body: JSON.stringify({ cart_id: 'cart_123' }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-1',
        },
        method: 'POST',
      }
    );

    const { POST } = await import('./route');
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe('agentic_session_1');
    expect(mockConvertUcpCartToCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        cartId: 'cart_123',
        requestUrl: 'http://localhost/api/agentic/checkout_sessions',
      })
    );
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('returns conversion errors for UCP cart references', async () => {
    vi.mocked(mockConvertUcpCartToCheckout).mockResolvedValueOnce(
      NextResponse.json({ error: 'Cart not found' }, { status: 404 })
    );
    const mockSupabase = { from: vi.fn() };
    vi.mocked(createAdminClient).mockReturnValue(mockSupabase as never);
    vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
      mockSupabase as never
    );

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions',
      {
        body: JSON.stringify({ cart_id: 'cart_missing' }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-1',
        },
        method: 'POST',
      }
    );

    const { POST } = await import('./route');
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Cart not found' });
  });

  it('creates a checkout session from native ACP item-shaped line_items and fulfillment_details', async () => {
    const insertSpy = vi.fn((_: Record<string, unknown>) => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'row-1', session_id: 'agentic_session_1' },
          error: null,
        }),
      })),
    }));
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'checkout_sessions') {
          return {
            insert: insertSpy,
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    vi.mocked(createAdminClient).mockReturnValue(mockSupabase as never);
    vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
      mockSupabase as never
    );
    vi.mocked(calculateCheckoutSession).mockResolvedValue(
      buildSuccessfulCheckoutCalculation()
    );

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions',
      {
        body: JSON.stringify({
          capabilities: {},
          currency: 'ngn',
          fulfillment_details: {
            name: 'Ada Buyer',
            phone_number: '+2348012345678',
            email: 'ada@example.com',
            address: {
              name: 'Ada Buyer',
              line_one: '12 Example Street',
              city: 'Lagos',
              state: 'LA',
              country: 'NG',
              postal_code: '100001',
            },
          },
          line_items: [{ id: 'product-1' }],
        }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-1',
        },
        method: 'POST',
      }
    );

    const { POST } = await import('./route');
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(calculateCheckoutSession).toHaveBeenCalledWith(
      mockSupabase,
      [{ id: 'product-1', quantity: 1 }],
      null,
      'NGN',
      'merchant-1'
    );
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        cart_items: [{ id: 'product-1', quantity: 1 }],
        shipping_address: expect.objectContaining({
          address: '12 Example Street',
          country_code: 'NG',
          phone: '+2348012345678',
        }),
      })
    );
  });

  it('creates a checkout session from a UCP line_items payload when adapted', async () => {
    const insertSpy = vi.fn((_: Record<string, unknown>) => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'row-1', session_id: 'agentic_session_1' },
          error: null,
        }),
      })),
    }));
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'checkout_sessions') {
          return {
            insert: insertSpy,
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue(mockSupabase as never);
    vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
      mockSupabase as never
    );
    vi.mocked(calculateCheckoutSession).mockResolvedValue(
      buildSuccessfulCheckoutCalculation(2)
    );

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout-sessions',
      {
        body: JSON.stringify({
          currency: 'ngn',
          line_items: [
            {
              item: { id: 'product-1', price: 500000, title: 'Phone' },
              quantity: 2,
            },
          ],
        }),
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
    const response = await handleAgenticCheckoutSessionCreate(request, {
      requestBodyAdapter: adaptUcpCheckoutCreateRequestBody,
    });

    expect(response.status).toBe(201);
    expect(calculateCheckoutSession).toHaveBeenCalledWith(
      mockSupabase,
      [{ id: 'product-1', quantity: 2 }],
      null,
      'NGN',
      'merchant-1'
    );
    expect(reserveAgenticIdempotencyKey).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('"line_items"'),
        pathname: '/api/agentic/checkout-sessions',
      })
    );
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        cart_items: [{ id: 'product-1', quantity: 2 }],
        currency: 'NGN',
      })
    );
  });

  it('returns 400 without inserting a checkout session when no valid line items are available', async () => {
    const mockSupabase = {
      from: vi.fn(() => {
        throw new Error('Unexpected checkout session insert');
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue(mockSupabase as never);
    vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
      mockSupabase as never
    );
    vi.mocked(calculateCheckoutSession).mockResolvedValue({
      fulfillmentOptions: [],
      lineItems: [],
      messages: [
        {
          code: 'invalid',
          content: 'Item not-a-uuid not found.',
          content_type: 'plain',
          path: '$.items[0]',
          type: 'error',
        },
      ],
      selectedOptionId: undefined,
      totals: [{ amount: 0, display_text: 'Total Due', type: 'total' }],
    });

    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions',
      {
        body: JSON.stringify({ items: [{ id: 'not-a-uuid', quantity: 1 }] }),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-1',
        },
        method: 'POST',
      }
    );

    const { POST } = await import('./route');
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: 'No valid checkout items',
      messages: [
        {
          code: 'invalid',
          content: 'Item not-a-uuid not found.',
          content_type: 'plain',
          path: '$.items[0]',
          type: 'error',
        },
      ],
    });
    expect(mockSupabase.from).not.toHaveBeenCalledWith('checkout_sessions');
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'idem-1',
        merchantId: 'merchant-1',
        response: body,
        route: 'checkout_sessions.create',
        status: 400,
      })
    );
  });

  it('returns a recoverable error when idempotency response storage fails', async () => {
    const errorSpy = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    const insertSpy = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'row-1', session_id: 'agentic_session_1' },
          error: null,
        }),
      })),
    }));
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'checkout_sessions') {
          return { insert: insertSpy };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    vi.mocked(createAdminClient).mockReturnValue(mockSupabase as never);
    vi.mocked(createAgenticScopedSupabaseClient).mockReturnValue(
      mockSupabase as never
    );
    vi.mocked(storeAgenticIdempotencyResponse).mockResolvedValueOnce({
      error: new Error('idempotency write failed'),
      ok: false,
    });
    vi.mocked(calculateCheckoutSession).mockResolvedValue(
      buildSuccessfulCheckoutCalculation()
    );

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

    const { POST } = await import('./route');
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get('x-idempotency-warning')).toBe(
      'response-not-stored'
    );
    expect(body).toEqual({
      error: 'Idempotency response storage failed',
      idempotency_key: 'idem-1',
      recovery_action: 'read_checkout_session',
      session_id: 'agentic_session_1',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to store agentic idempotency response',
        merchantId: 'merchant-1',
        route: 'checkout_sessions.create',
      })
    );
    errorSpy.mockRestore();
  });
});
