import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgenticCheckoutOrder } from '@/lib/agentic/checkout-order-dispatch';
import {
  reserveAgenticIdempotencyKey,
  storeAgenticIdempotencyResponse,
} from '@/lib/agentic/idempotency';
import {
  createDedicatedVirtualAccount,
  isValidPaystackSubaccountCode,
} from '@/lib/agentic/paystack';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { completionConfirmationSecret } from './route-complete-test-helpers';
import { paymentStateTestHelpers } from './route-payment-state-test-helpers';

const mockVerifyAgenticApiKey = vi.fn(() => true);
const mockResolveAgenticMerchantContext = vi.fn(() =>
  Promise.resolve<{
    agentic_checkout_enabled?: boolean;
    agent_user_agent_allowlist?: string[];
    agent_user_agent_denylist?: string[];
    id: string;
    paystack_subaccount_code: string | null;
    pay_on_delivery_enabled: boolean;
    slug: string;
  }>({
    id: 'merchant-1',
    paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
    pay_on_delivery_enabled: true,
    slug: 'ogabassey',
  })
);
vi.mock('@/lib/agentic/auth', () => ({
  verifyAgenticApiKey: mockVerifyAgenticApiKey,
}));
vi.mock('@/lib/agentic/merchant-context', () => ({
  AGENTIC_CHECKOUT_DISABLED_ERROR: 'Agentic checkout disabled',
  isAgenticMerchantCheckoutEnabled: (merchant: {
    agentic_checkout_enabled?: boolean;
  }) => merchant.agentic_checkout_enabled !== false,
  resolveAgenticMerchantContext: mockResolveAgenticMerchantContext,
}));
vi.mock('@/lib/agentic/checkout', () => ({
  calculateCheckoutSession: vi.fn(),
}));
vi.mock('@/lib/agentic/idempotency', () => ({
  reserveAgenticIdempotencyKey: vi.fn(),
  storeAgenticIdempotencyResponse: vi.fn(),
}));
vi.mock('@/lib/agentic/paystack', () => ({
  createDedicatedVirtualAccount: vi.fn(),
  isValidPaystackSubaccountCode: vi.fn(() => true),
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
vi.mock('@/lib/agentic/checkout-order-dispatch', () => ({
  createAgenticCheckoutOrder: vi.fn(),
  markAgenticCheckoutOrderCanceled: vi.fn(),
  sendAgenticOrderCreatedWebhook: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

const {
  buildCompleteRequest,
  getPaymentState,
  mockCalculatedSession,
  mockSuccessfulPaymentSessionSupabase,
} = paymentStateTestHelpers;

describe('POST /api/agentic/checkout_sessions/[id]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('OPENAI_AGENTIC_CONFIRMATION_KEY', completionConfirmationSecret);
    mockVerifyAgenticApiKey.mockReturnValue(true);
    mockResolveAgenticMerchantContext.mockResolvedValue({
      id: 'merchant-1',
      paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
      pay_on_delivery_enabled: true,
      slug: 'ogabassey',
    });
    vi.mocked(isValidPaystackSubaccountCode).mockReturnValue(true);
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

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('applies request body adapters before validating complete payloads', async () => {
    mockResolveAgenticMerchantContext.mockResolvedValue({
      agentic_checkout_enabled: false,
      id: 'merchant-1',
      pay_on_delivery_enabled: true,
      paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
      slug: 'ogabassey',
    });
    const requestBody = {
      payment: { instruments: [{ handler_id: 'pay_on_delivery' }] },
    };
    const request = new NextRequest(
      'http://localhost/api/agentic/checkout_sessions/agentic_session_1/complete',
      {
        body: JSON.stringify(requestBody),
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idem-1',
        },
        method: 'POST',
      }
    );
    const requestBodyAdapter = vi.fn(() => ({
      buyer: {
        email: 'buyer@example.com',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone_number: '+2348012345678',
      },
      payment_data: { provider: 'pay_on_delivery' },
    }));

    const { handleAgenticCheckoutSessionComplete } = await import(
      './checkout-session-complete-handler'
    );
    const response = await handleAgenticCheckoutSessionComplete(
      request,
      {
        params: Promise.resolve({ id: 'agentic_session_1' }),
      },
      { requestBodyAdapter }
    );

    expect(requestBodyAdapter).toHaveBeenCalledWith(requestBody);
    expect(response.status).toBe(403);
  });

  it('rejects checkout completion when the merchant subaccount is missing', async () => {
    mockResolveAgenticMerchantContext.mockResolvedValue({
      id: 'merchant-1',
      paystack_subaccount_code: null,
      pay_on_delivery_enabled: true,
      slug: 'ogabassey',
    });
    vi.mocked(isValidPaystackSubaccountCode).mockReturnValue(false);
    mockSuccessfulPaymentSessionSupabase();
    mockCalculatedSession();

    const { POST } = await import('./route');
    const response = await POST(buildCompleteRequest(), {
      params: Promise.resolve({ id: 'agentic_session_1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(424);
    expect(body).toEqual({
      error: 'Merchant Paystack subaccount is not configured',
    });
    expect(createDedicatedVirtualAccount).not.toHaveBeenCalled();
  });

  it('returns 403 when the merchant disables agentic checkout', async () => {
    mockResolveAgenticMerchantContext.mockResolvedValue({
      agentic_checkout_enabled: false,
      id: 'merchant-1',
      pay_on_delivery_enabled: true,
      paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
      slug: 'ogabassey',
    });

    const { POST } = await import('./route');
    const response = await POST(buildCompleteRequest(), {
      params: Promise.resolve({ id: 'agentic_session_1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Agentic checkout disabled' });
    expect(reserveAgenticIdempotencyKey).toHaveBeenCalled();
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'idem-1',
        merchantId: 'merchant-1',
        response: { error: 'Agentic checkout disabled' },
        route: 'checkout_sessions.complete',
        status: 403,
      })
    );
    expect(createDedicatedVirtualAccount).not.toHaveBeenCalled();
    expect(createAgenticCheckoutOrder).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller user-agent is not allowlisted', async () => {
    mockResolveAgenticMerchantContext.mockResolvedValue({
      agent_user_agent_allowlist: ['trusted-agent'],
      id: 'merchant-1',
      pay_on_delivery_enabled: true,
      paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
      slug: 'ogabassey',
    });

    const { POST } = await import('./route');
    const response = await POST(buildCompleteRequest(), {
      params: Promise.resolve({ id: 'agentic_session_1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'Agent client not allowlisted' });
    expect(reserveAgenticIdempotencyKey).not.toHaveBeenCalled();
    expect(storeAgenticIdempotencyResponse).not.toHaveBeenCalled();
    expect(createDedicatedVirtualAccount).not.toHaveBeenCalled();
    expect(createAgenticCheckoutOrder).not.toHaveBeenCalled();
  });

  it('stores DVA payment state without writing agent-only checkout statuses', async () => {
    const {
      readChain,
      supabase: mockSupabase,
      updateSpy,
    } = mockSuccessfulPaymentSessionSupabase();
    mockCalculatedSession();
    vi.mocked(createDedicatedVirtualAccount).mockResolvedValue({
      account_name: 'Baci Test',
      account_number: '1234567890',
      assigned: true,
      bank_name: 'Paystack-Titan',
      currency: 'NGN',
    });
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: { order: { id: 'order-1' }, wallet: null, amountDueToGateway: 0 },
      error: undefined,
      ok: true,
      orderId: 'order-1',
      status: 201,
      statusText: 'Created',
    });
    const params = { params: Promise.resolve({ id: 'agentic_session_1' }) };
    const { POST } = await import('./route');
    const response = await POST(buildCompleteRequest(), params);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(readChain.eq).toHaveBeenCalledWith(
      'session_id',
      'agentic_session_1'
    );
    expect(createDedicatedVirtualAccount).toHaveBeenCalledWith(
      expect.any(Object),
      { subaccount: 'ACCT_TESTMOCK1234567' }
    );
    expect(readChain.eq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'processing',
        order_id: 'order-1',
        payment_method: 'bank_transfer',
        payment_provider: 'paystack',
        virtual_account_number: '1234567890',
      })
    );
    expect(getPaymentState(updateSpy.mock.calls[0]?.[0])).toBe(
      'claiming_payment'
    );
    const orderPayload = vi.mocked(createAgenticCheckoutOrder).mock
      .calls[0]?.[0] as {
      items: Record<string, unknown>[];
    };
    expect(orderPayload).toBeDefined();
    expect(Array.isArray(orderPayload.items)).toBe(true);
    expect(orderPayload.items).toHaveLength(1);
    expect(orderPayload.items[0]).toMatchObject({
      name: 'Phone',
      product_id: 'product-1',
      quantity: 1,
    });
    expect(vi.mocked(createAgenticCheckoutOrder).mock.calls[0]?.[1]).toBe(
      mockSupabase
    );
    const updatePayload = updateSpy.mock.calls.find(
      ([payload]) => getPaymentState(payload) === 'payment_pending'
    )?.[0];
    expect(updatePayload).not.toHaveProperty('buyer');
    expect(updatePayload?.metadata).toMatchObject({
      agentic: {
        existing: true,
        payment_state: 'payment_pending',
      },
    });
    expect(body).toMatchObject({
      id: 'agentic_session_1',
      status: 'ready_for_payment',
      order: {
        id: 'order-1',
        status: 'payment_pending',
      },
      order_id: 'order-1',
    });
  });

  it('creates a pay-on-delivery order without generating a Paystack account', async () => {
    const { updateSpy } = mockSuccessfulPaymentSessionSupabase();
    mockCalculatedSession();
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: {
        order: { id: 'order-pod-1' },
        wallet: null,
        amountDueToGateway: 0,
      },
      error: undefined,
      ok: true,
      orderId: 'order-pod-1',
      status: 201,
      statusText: 'Created',
    });

    const { POST } = await import('./route');
    const response = await POST(
      buildCompleteRequest({
        paymentData: { provider: 'pay_on_delivery' },
      }),
      { params: Promise.resolve({ id: 'agentic_session_1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createDedicatedVirtualAccount).not.toHaveBeenCalled();
    expect(createAgenticCheckoutOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_method: 'pay_on_delivery',
        payment_status: 'pending',
      }),
      expect.any(Object),
      { boundPrincipalId: null }
    );
    const completedPayload = updateSpy.mock.calls.find(
      ([payload]) => payload.status === 'completed'
    )?.[0];
    expect(completedPayload).toMatchObject({
      order_id: 'order-pod-1',
      payment_method: 'pay_on_delivery',
      payment_provider: null,
      status: 'completed',
      virtual_account_bank: null,
      virtual_account_name: null,
      virtual_account_number: null,
    });
    expect(body).toMatchObject({
      id: 'agentic_session_1',
      order: {
        id: 'order-pod-1',
        status: 'payment_pending',
      },
      payment_details: {
        type: 'pay_on_delivery',
      },
      status: 'completed',
    });
  });

  it('rejects pay on delivery when the merchant has not enabled it', async () => {
    mockResolveAgenticMerchantContext.mockResolvedValue({
      id: 'merchant-1',
      pay_on_delivery_enabled: false,
      paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
      slug: 'ogabassey',
    });
    mockSuccessfulPaymentSessionSupabase();
    mockCalculatedSession();

    const { POST } = await import('./route');
    const response = await POST(
      buildCompleteRequest({
        paymentData: { provider: 'pay_on_delivery' },
      }),
      { params: Promise.resolve({ id: 'agentic_session_1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: 'Pay on delivery is not enabled for this merchant',
    });
    expect(createDedicatedVirtualAccount).not.toHaveBeenCalled();
    expect(createAgenticCheckoutOrder).not.toHaveBeenCalled();
  });
});
