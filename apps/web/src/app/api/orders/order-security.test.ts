import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAgenticOrderTax } from '@/lib/agentic/checkout-order-tax';
import { authenticateApiRequest } from '@/lib/api-auth';
import { normalizeEnvBoolean } from '@/lib/env-boolean';
import { createQuizVoucherToken } from '@/lib/quiz-voucher-token';
import { POST } from './route';

const {
  mockNotifyNewOrder,
  mockNotifyPaymentReceived,
  mockSendEmail,
  mockCreateGiglShipment,
  mockAfter,
  mockCreateAdminClient,
} = vi.hoisted(() => ({
  mockNotifyNewOrder: vi.fn(() => Promise.resolve()),
  mockNotifyPaymentReceived: vi.fn(() => Promise.resolve()),
  mockSendEmail: vi.fn(() => Promise.resolve({ success: true })),
  mockCreateGiglShipment: vi.fn(),
  mockAfter: vi.fn((callback: () => unknown) => callback()),
  mockCreateAdminClient: vi.fn(),
}));

// Mock env
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://mock.supabase.co',
  getSupabaseAnonKey: () => 'mock-key',
  getSupabaseServiceRoleKey: () => 'mock-service-key',
  getRootDomain: () => 'localhost:3000',
  getQuizPhaseEnv: () => process.env.QUIZ_PHASE ?? '1a',
  getQuizProductionApprovedEnv: () =>
    normalizeEnvBoolean(process.env.QUIZ_PRODUCTION_APPROVED) ?? false,
  getQuizRpcServerSecret: () => process.env.QUIZ_RPC_SERVER_SECRET,
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
  hasPermission: vi.fn(() => true),
}));

vi.mock('@/lib/agentic/checkout-order-tax', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/agentic/checkout-order-tax')
  >('@/lib/agentic/checkout-order-tax');

  return {
    ...actual,
    computeAgenticOrderTax: vi.fn(actual.computeAgenticOrderTax),
  };
});

// Shared mock for chainable methods
const sharedChainableMock: any = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({
    data: {
      id: '123e4567-e89b-12d3-a456-426614174000', // Matches validOrderPayload
      business_name: 'Test Merchant',
      country: 'NG',
      slug: 'test-merchant',
      support_email: 'support@example.com',
      email_sender_name: 'Test Store',
      email: 'merchant@example.com',
    },
    error: null,
  }),
  // B3.5 round 7: `computeAgenticOrderTax` queries
  // `merchants.maybeSingle()` for VAT status and
  // `products.eq(...).in(...).returns()` for product VAT data.
  // Default returns shape the helper to "merchant not registered"
  // and "no products" → helper short-circuits to 0, existing
  // assertions unchanged.
  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  in: vi.fn().mockReturnThis(),
  returns: vi.fn().mockResolvedValue({ data: [], error: null }),
  // computeOrderNegotiationDiscount loads `products` via `.overrideTypes()`
  // (the modern postgrest idiom). Default to no-data so the loader finds no
  // catalog rows → returns null → no discount/rejection, route proceeds.
  overrideTypes: vi.fn().mockResolvedValue({ data: [], error: null }),
  insert: vi.fn().mockResolvedValue({ error: null }),
  update: vi.fn().mockReturnThis(),
  // biome-ignore lint/suspicious/noThenProperty: needed for thenable mock
  then: (resolve: any) => Promise.resolve().then(resolve),
};

// The route loads quiz awards via `.select(...).in('id', ids)` and gates on
// status === 'approved' && award_type === 'store_credit' BEFORE the compliance
// check. Echo an approved store-credit row per queried id (event permit
// evidence present) so the status gate passes; tests override `.in` when they
// need a different status or an unverified event.
const quizAwardChainableMock: any = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn((_column: string, ids: string[]) =>
    Promise.resolve({
      data: ids.map((id) => ({
        id,
        status: 'approved',
        award_type: 'store_credit',
        quiz_events: {
          compliance_verified: true,
          nlrc_permit_ref: 'NLRC-1',
        },
      })),
      error: null,
    })
  ),
};

const mockSupabase = {
  auth: {
    getUser: vi.fn(),
  },
  from: vi.fn((table?: string) =>
    table === 'quiz_awards' ? quizAwardChainableMock : sharedChainableMock
  ),
  rpc: vi.fn(
    (name: string, _args?: unknown): Promise<{ data: any; error: any }> => {
      // B3.5 round 7: helper's variant lookup routes through this
      // SDF on the same scoped client.
      if (name === 'get_order_variant_overrides') {
        return Promise.resolve({ data: [], error: null });
      }
      return Promise.resolve({
        data: [
          {
            id: 'order-id',
            order_number: 'ORD-123',
            total: 1000,
            subtotal: 1000,
            shipping_fee: 0,
            customer_id: 'customer-id',
          },
        ],
        error: null,
      });
    }
  ),
};

// The route reads the persisted order currency with an admin client after the
// creation RPC. Keep that post-create read local to this security suite: the
// test's Supabase URL is deliberately fake, and allowing this query to use a
// real client makes an auth regression test wait for network retries.
const adminOrderReadQuery = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({
    data: { currency: 'NGN', shipping_provider: null },
    error: null,
  }),
};

const mockAdminSupabase = {
  from: vi.fn(() => adminOrderReadQuery),
  // The route gates immediate (POD/invoice/wallet) delivery on the
  // atomic claim/complete RPCs: the winner delivers, losers skip.
  rpc: vi.fn(async (functionName: string) => {
    if (functionName === 'claim_immediate_order_notification') {
      return { data: [{ claimed: true }], error: null };
    }
    return { data: null, error: null };
  }),
};

mockCreateAdminClient.mockReturnValue(mockAdminSupabase);

function mockAuthUser(id: string) {
  return {
    id,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

// B3.5 round 7 (PR #1622): the route's server-side tax recompute
// reads through the caller's scoped supabase client (the same
// `mockSupabase` defined above) — no admin/service-role client in
// the Next.js layer. The helper's `merchants.maybeSingle()` and
// `products.in().returns()` reads default to no-data via the
// shared mock chainables; helper short-circuits to 0 and the
// existing assertions stay unchanged.

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
  }),
}));

vi.mock('next/server', async () => {
  const actual =
    await vi.importActual<typeof import('next/server')>('next/server');

  return {
    ...actual,
    after: mockAfter,
  };
});

// Mock other dependencies
vi.mock('@/lib/email-templates', () => ({
  generateOrderConfirmationEmail: vi.fn(),
  generateOrderConfirmationText: vi.fn(),
}));

vi.mock('@/lib/expo-push', () => ({
  notifyNewInvoice: vi.fn(() => Promise.resolve()),
  notifyNewOrder: mockNotifyNewOrder,
  notifyPaymentReceived: mockNotifyPaymentReceived,
}));

vi.mock('@/lib/zeptomail', () => ({
  sendEmail: mockSendEmail,
}));

vi.mock('@/lib/geo-privacy', () => ({
  detectPrivacyRegion: vi.fn().mockResolvedValue({
    country: 'NG',
    region: 'Lagos',
    shouldApplyLDU: false,
  }),
}));

vi.mock('@/lib/shipping/providers/gigl', () => ({
  giglProvider: {
    getLocations: vi.fn().mockResolvedValue([]),
  },
}));

// Mock logger to suppress console noise
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Order API Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const validOrderPayload = {
    merchant_id: '123e4567-e89b-12d3-a456-426614174000',
    customer_email: 'customer@example.com',
    customer_name: 'Test Customer',
    customer_phone: '1234567890',
    items: [
      {
        product_id: 'product-id',
        quantity: 1,
        price: 1000,
        name: 'Test Product',
      },
    ],
    subtotal: 1000,
    shipping_fee: 0,
    discount_amount: 0,
    tax_amount: 0,
    payment_method: 'card',
    payment_status: 'unpaid',
    shipping_status: 'pending',
    shipping_address: {
      address: '123 Test St',
      city: 'Lagos',
      state: 'Lagos',
    },
    user_id: '123e4567-e89b-12d3-a456-426614174001', // Valid UUID
  };

  it('should prevent unauthenticated users from setting user_id', async () => {
    // Mock unauthenticated request (guest checkout)
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });

    const request = new NextRequest('http://localhost:3000/api/orders', {
      method: 'POST',
      body: JSON.stringify(validOrderPayload),
    });

    await POST(request);

    // Verify RPC call has p_user_id: null
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({
        p_user_id: null, // CRITICAL: Must be null
      })
    );
  });

  it('should allow authenticated users to use their own user_id', async () => {
    const authUserId = '123e4567-e89b-12d3-a456-426614174002'; // Valid UUID

    // Mock authenticated request
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(authUserId),
      error: null,
      supabase: mockSupabase as unknown as never,
    });

    const request = new NextRequest('http://localhost:3000/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...validOrderPayload,
        user_id: authUserId, // Matches auth user
      }),
    });

    await POST(request);

    // Verify RPC call has p_user_id: authUserId
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({
        p_user_id: authUserId,
      })
    );
  });

  it('should ignore body user_id and use auth user_id if authenticated', async () => {
    const authUserId = '123e4567-e89b-12d3-a456-426614174002'; // Valid UUID
    const spoofUserId = '123e4567-e89b-12d3-a456-426614174003'; // Valid UUID

    // Mock authenticated request
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(authUserId),
      error: null,
      supabase: mockSupabase as unknown as never,
    });

    const request = new NextRequest('http://localhost:3000/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...validOrderPayload,
        user_id: spoofUserId, // Mismatch with auth user
      }),
    });

    const response = await POST(request);

    // The API route currently returns 403 on mismatch.
    // "if (user && user_id && user_id !== user.id)"

    expect(response.status).toBe(403);

    // RPC should NOT be called
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('should use mobile Bearer auth to bind p_user_id without relying on cookies', async () => {
    const authUserId = '123e4567-e89b-12d3-a456-426614174004';

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: mockAuthUser(authUserId),
      error: null,
      supabase: mockSupabase as unknown as never,
    });

    const request = new NextRequest('http://localhost:3000/api/orders', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer mobile-access-token',
      },
      body: JSON.stringify({
        ...validOrderPayload,
        user_id: authUserId,
      }),
    });

    await POST(request);

    expect(authenticateApiRequest).toHaveBeenCalledOnce();
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({
        p_user_id: authUserId,
      })
    );
  });

  it('treats pay_on_delivery like pod for downstream notification handling', async () => {
    const request = new NextRequest('http://localhost:3000/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...validOrderPayload,
        payment_method: 'pay_on_delivery',
        payment_status: 'pending',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockNotifyNewOrder).toHaveBeenCalledWith(
      validOrderPayload.merchant_id,
      'order-id',
      'ORD-123',
      validOrderPayload.customer_name,
      1000,
      'NGN'
    );
    expect(mockNotifyPaymentReceived).not.toHaveBeenCalled();
  });

  it('returns 400 when create_storefront_order rejects an unsupported payment_status', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: 'invalid_payment_status',
      },
    });

    const request = new NextRequest('http://localhost:3000/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...validOrderPayload,
        payment_status: 'paid',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.details).toBe('invalid_payment_status');
  });

  it('returns 400 when create_storefront_order rejects an unsupported payment_status via error code', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'invalid_payment_status',
      },
    });

    const request = new NextRequest('http://localhost:3000/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...validOrderPayload,
        payment_status: 'paid',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.details).toBe('invalid_payment_status');
  });

  it('returns 400 when create_storefront_order rejects an unsupported payment_status via PostgREST error shape', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'P0001',
        message: 'invalid_payment_status',
      },
    });

    const request = new NextRequest('http://localhost:3000/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...validOrderPayload,
        payment_status: 'paid',
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.details).toBe('invalid_payment_status');
  });

  it('returns 400 before order creation when a raw discount amount is submitted', async () => {
    const request = new NextRequest('http://localhost:3000/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...validOrderPayload,
        discount_amount: 500,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('discount_amount_not_supported');
    expect(mockSupabase.rpc).not.toHaveBeenCalledWith(
      'create_storefront_order',
      expect.anything()
    );
  });

  it('does not compute tax for unsupported raw discount amounts', async () => {
    const request = new NextRequest('http://localhost:3000/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...validOrderPayload,
        discount_amount: 500,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('discount_amount_not_supported');
    expect(computeAgenticOrderTax).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('does not send unsupported raw discount amounts to the order RPC', async () => {
    const request = new NextRequest('http://localhost:3000/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...validOrderPayload,
        discount_amount: 500,
      }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.code).toBe('discount_amount_not_supported');
    expect(mockSupabase.rpc).not.toHaveBeenCalledWith(
      'create_storefront_order',
      expect.anything()
    );
  });

  it('waits for pay_on_delivery confirmation email dispatch before responding', async () => {
    let signalEmailStarted: (() => void) | undefined;
    let resolveEmail:
      | ((value: { success: boolean; messageId: string }) => void)
      | undefined;
    const emailStarted = new Promise<void>((resolve) => {
      signalEmailStarted = resolve;
    });

    mockSendEmail.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          signalEmailStarted?.();
          resolveEmail = resolve;
        })
    );

    const request = new NextRequest('http://localhost:3000/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...validOrderPayload,
        payment_method: 'pay_on_delivery',
        payment_status: 'pending',
      }),
    });

    let settled = false;
    const responsePromise = POST(request).then((response) => {
      settled = true;
      return response;
    });

    await emailStarted;
    expect(settled).toBe(false);

    resolveEmail?.({ success: true, messageId: 'zepto-msg-1' });

    const response = await responsePromise;
    expect(response.status).toBe(201);
  });

  it('does not try to book GIGL shipments during order creation', async () => {
    const request = new NextRequest('http://localhost:3000/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        ...validOrderPayload,
        shipping_provider: 'GIGL',
        selected_quote_id: '11111111-1111-4111-8111-111111111111',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockCreateGiglShipment).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'create_storefront_order',
      expect.objectContaining({
        p_selected_quote_id: '11111111-1111-4111-8111-111111111111',
        p_shipping_provider: 'GIGL',
        p_tracking_number: null,
      })
    );
  });

  describe('Quiz voucher production guard', () => {
    it('rejects quiz voucher orders when production approval is false', async () => {
      vi.stubEnv('QUIZ_PHASE', 'production');
      vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'false');
      vi.mocked(authenticateApiRequest).mockResolvedValue({
        user: mockAuthUser(validOrderPayload.user_id),
        error: null,
        supabase: mockSupabase as unknown as never,
      });

      const request = new NextRequest('http://localhost:3000/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...validOrderPayload,
          items: [
            {
              ...validOrderPayload.items[0],
              price: 0,
              voucher_token: 'quiz-voucher-token',
            },
          ],
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data).toEqual({
        code: 'quiz_production_not_approved',
        error: 'Quiz vouchers are not approved for production use',
      });
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
    });

    // QUIZ_PRODUCTION_APPROVED alone is not enough; Phase 1b event permit
    // evidence is intentionally unwired, so POST(request) must still reject.
    it('keeps quiz voucher orders fail-closed until event permit evidence is wired', async () => {
      vi.stubEnv('QUIZ_PHASE', 'production');
      vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'true');
      vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'voucher-secret');
      vi.mocked(authenticateApiRequest).mockResolvedValue({
        user: mockAuthUser(validOrderPayload.user_id),
        error: null,
        supabase: mockSupabase as unknown as never,
      });
      // Award is redeemable (approved store-credit) so it passes the status
      // gate, but its event has no permit evidence (compliance_verified false),
      // so the production guard must still reject.
      quizAwardChainableMock.in.mockImplementationOnce(
        (_column: string, ids: string[]) =>
          Promise.resolve({
            data: ids.map((id) => ({
              id,
              status: 'approved',
              award_type: 'store_credit',
              quiz_events: {
                compliance_verified: false,
                nlrc_permit_ref: null,
              },
            })),
            error: null,
          })
      );
      const productId = '22222222-2222-4222-8222-222222222222';
      const token = createQuizVoucherToken({
        payload: {
          awardId: '11111111-1111-4111-8111-111111111111',
          condition: null,
          expiresAt: '2099-05-22T12:00:00.000Z',
          productId,
          userId: validOrderPayload.user_id,
          variantId: null,
        },
        secret: 'voucher-secret',
      });

      const request = new NextRequest('http://localhost:3000/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...validOrderPayload,
          items: [
            {
              ...validOrderPayload.items[0],
              product_id: productId,
              price: 0,
              voucher_token: token,
            },
          ],
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data).toEqual({
        code: 'quiz_production_not_approved',
        error: 'Quiz vouchers are not approved for production use',
      });
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
    });
  });

  describe('Variant attributes handling', () => {
    beforeEach(() => {
      vi.mocked(authenticateApiRequest).mockResolvedValue({
        user: mockAuthUser('123e4567-e89b-12d3-a456-426614174099'),
        error: null,
        supabase: mockSupabase as unknown as never,
      });
      // Restore mocks cleared by outer beforeEach
      sharedChainableMock.select.mockReturnThis();
      sharedChainableMock.eq.mockReturnThis();
      sharedChainableMock.single.mockResolvedValue({
        data: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          business_name: 'Test Merchant',
          country: 'NG',
          slug: 'test-merchant',
          support_email: 'support@example.com',
          email_sender_name: 'Test Store',
          email: 'merchant@example.com',
        },
        error: null,
      });
      mockSupabase.rpc.mockResolvedValue({
        data: [
          {
            id: 'order-id',
            order_number: 'ORD-123',
            total: 1000,
            subtotal: 1000,
            shipping_fee: 0,
            customer_id: 'customer-id',
          },
        ],
        error: null,
      });
    });

    it('forwards variantAttributes (camelCase) to RPC', async () => {
      const payload = {
        ...validOrderPayload,
        user_id: '123e4567-e89b-12d3-a456-426614174099',
        items: [
          {
            product_id: 'product-id',
            quantity: 1,
            price: 1000,
            name: 'Test Product',
            variantId: 'v1',
            variantAttributes: { color: 'Red', storage: '256GB' },
          },
        ],
      };

      const request = new NextRequest('http://localhost:3000/api/orders', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const response = await POST(request);
      expect(response.status).toBeLessThan(300);

      // B3.5 round 7: rpc is now called for both
      // `get_order_variant_overrides` (helper) and
      // `create_storefront_order` (order create). Pick the order
      // create explicitly so a future helper change can't shift
      // the index out from under these assertions.
      const orderCreateCall = mockSupabase.rpc.mock.calls.find(
        (c) => c[0] === 'create_storefront_order'
      );
      if (!orderCreateCall) {
        throw new Error('create_storefront_order rpc was not called');
      }
      const rpcArgs = orderCreateCall[1] as any;
      const items = Array.isArray(rpcArgs.p_items)
        ? rpcArgs.p_items
        : JSON.parse(rpcArgs.p_items);
      expect(items[0].variant_attributes).toEqual({
        color: 'Red',
        storage: '256GB',
      });
    });

    it('forwards variant_attributes (snake_case) to RPC', async () => {
      const payload = {
        ...validOrderPayload,
        user_id: '123e4567-e89b-12d3-a456-426614174099',
        items: [
          {
            product_id: 'product-id',
            quantity: 1,
            price: 1000,
            name: 'Test Product',
            variant_id: 'v1',
            variant_attributes: { color: 'Blue' },
          },
        ],
      };

      const request = new NextRequest('http://localhost:3000/api/orders', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const response = await POST(request);
      expect(response.status).toBeLessThan(300);

      // B3.5 round 7: rpc is now called for both
      // `get_order_variant_overrides` (helper) and
      // `create_storefront_order` (order create). Pick the order
      // create explicitly so a future helper change can't shift
      // the index out from under these assertions.
      const orderCreateCall = mockSupabase.rpc.mock.calls.find(
        (c) => c[0] === 'create_storefront_order'
      );
      if (!orderCreateCall) {
        throw new Error('create_storefront_order rpc was not called');
      }
      const rpcArgs = orderCreateCall[1] as any;
      const items = Array.isArray(rpcArgs.p_items)
        ? rpcArgs.p_items
        : JSON.parse(rpcArgs.p_items);
      expect(items[0].variant_attributes).toEqual({ color: 'Blue' });
    });

    it('defaults variant_attributes to {} when both keys missing', async () => {
      const request = new NextRequest('http://localhost:3000/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...validOrderPayload,
          user_id: '123e4567-e89b-12d3-a456-426614174099',
        }),
      });

      await POST(request);

      // B3.5 round 7: rpc is now called for both
      // `get_order_variant_overrides` (helper) and
      // `create_storefront_order` (order create). Pick the order
      // create explicitly so a future helper change can't shift
      // the index out from under these assertions.
      const orderCreateCall = mockSupabase.rpc.mock.calls.find(
        (c) => c[0] === 'create_storefront_order'
      );
      if (!orderCreateCall) {
        throw new Error('create_storefront_order rpc was not called');
      }
      const rpcArgs = orderCreateCall[1] as any;
      const items = Array.isArray(rpcArgs.p_items)
        ? rpcArgs.p_items
        : JSON.parse(rpcArgs.p_items);
      expect(items[0].variant_attributes).toEqual({});
    });

    it('forwards image_url to RPC', async () => {
      const request = new NextRequest('http://localhost:3000/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...validOrderPayload,
          user_id: '123e4567-e89b-12d3-a456-426614174099',
          items: [
            {
              ...validOrderPayload.items[0],
              image_url: 'https://cdn.example.com/gold.jpg',
            },
          ],
        }),
      });

      const response = await POST(request);
      expect(response.status).toBeLessThan(300);

      // B3.5 round 7: filter to the create_storefront_order call
      // since rpc is also invoked for `get_order_variant_overrides`.
      const orderCreateCall = mockSupabase.rpc.mock.calls.find(
        (c) => c[0] === 'create_storefront_order'
      );
      if (!orderCreateCall) {
        throw new Error('create_storefront_order rpc was not called');
      }
      const rpcArgs = orderCreateCall[1] as any;
      const items = Array.isArray(rpcArgs.p_items)
        ? rpcArgs.p_items
        : JSON.parse(rpcArgs.p_items);
      expect(items[0].image_url).toBe('https://cdn.example.com/gold.jpg');
    });

    it.each([
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'JavaScript:alert(1)',
      '  javascript:alert(1)',
      '\tjavascript:alert(1)',
      'javascript:alert(1) ',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///tmp/unsafe.png',
      'filesystem:https://example.com/unsafe.png',
    ])('rejects unsafe image_url schemes before calling the RPC: %s', async (imageUrl) => {
      const request = new NextRequest('http://localhost:3000/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...validOrderPayload,
          user_id: '123e4567-e89b-12d3-a456-426614174099',
          items: [
            {
              ...validOrderPayload.items[0],
              image_url: imageUrl,
            },
          ],
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid request data');
      expect(mockSupabase.rpc).not.toHaveBeenCalled();
    });

    it('forwards normalized item condition to RPC', async () => {
      const request = new NextRequest('http://localhost:3000/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          ...validOrderPayload,
          user_id: '123e4567-e89b-12d3-a456-426614174099',
          items: [
            {
              ...validOrderPayload.items[0],
              condition: 'Open Box',
            },
          ],
        }),
      });

      await POST(request);

      // B3.5 round 7: rpc is now called for both
      // `get_order_variant_overrides` (helper) and
      // `create_storefront_order` (order create). Pick the order
      // create explicitly so a future helper change can't shift
      // the index out from under these assertions.
      const orderCreateCall = mockSupabase.rpc.mock.calls.find(
        (c) => c[0] === 'create_storefront_order'
      );
      if (!orderCreateCall) {
        throw new Error('create_storefront_order rpc was not called');
      }
      const rpcArgs = orderCreateCall[1] as any;
      const items = Array.isArray(rpcArgs.p_items)
        ? rpcArgs.p_items
        : JSON.parse(rpcArgs.p_items);
      expect(items[0].condition).toBe('open_box');
    });
  });
});
