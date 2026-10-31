import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import { createAgenticCheckoutOrder } from '@/lib/agentic/checkout-order-dispatch';
import {
  reserveAgenticIdempotencyKey,
  storeAgenticIdempotencyResponse,
} from '@/lib/agentic/idempotency';
import { createDedicatedVirtualAccount } from '@/lib/agentic/paystack';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { completionConfirmationSecret } from './route-complete-test-helpers';
import { paymentStateTestHelpers } from './route-payment-state-test-helpers';

const mockVerifyAgenticApiKey = vi.fn(() => true);
const mockResolveAgenticMerchantContext = vi.fn(() =>
  Promise.resolve({
    id: 'merchant-1',
    paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
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
  resolveAgenticMerchantContextFromRpc: mockResolveAgenticMerchantContext,
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
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

const {
  buildCompleteRequest,
  mockCalculatedSession,
  mockSession,
  makeReadySession,
} = paymentStateTestHelpers;

const { POST } = await import('./route');

const storedCheckoutSnapshot = {
  line_items: [
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
  totals: [{ type: 'total', display_text: 'Total Due', amount: 500000 }],
};

describe('POST /api/agentic/checkout_sessions/[id]/complete payment state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('OPENAI_AGENTIC_CONFIRMATION_KEY', completionConfirmationSecret);
    mockVerifyAgenticApiKey.mockReturnValue(true);
    mockResolveAgenticMerchantContext.mockResolvedValue({
      id: 'merchant-1',
      paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
      slug: 'ogabassey',
    });
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

  it('returns 400 when the session id route param is invalid', async () => {
    const response = await POST(buildCompleteRequest(), {
      params: Promise.resolve({ id: '../bad' }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid route params' });
    expect(mockResolveAgenticMerchantContext).not.toHaveBeenCalled();
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
  });

  it('requires completion authorization before payment side effects', async () => {
    const { updateSpy } = mockSession(makeReadySession());
    mockCalculatedSession();

    const params = { params: Promise.resolve({ id: 'agentic_session_1' }) };
    const response = await POST(
      buildCompleteRequest({ includeAuthorization: false }),
      params
    );
    const body = await response.json();

    expect(response.status).toBe(428);
    expect(body).toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
      error: 'Human confirmation required',
      retryable: true,
    });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(createDedicatedVirtualAccount).not.toHaveBeenCalled();
    expect(createAgenticCheckoutOrder).not.toHaveBeenCalled();
  });

  it('does not mint a new replay for existing payment details while paused', async () => {
    vi.stubEnv('AGENTIC_PAYSTACK_DVA_MODE', 'paused');
    const { updateSpy } = mockSession({
      ...makeReadySession(),
      status: 'processing',
      order_id: 'order-1',
      payment_reference: '1234567890',
      virtual_account_bank: 'Paystack-Titan',
      virtual_account_name: 'Baci Test',
      virtual_account_number: '1234567890',
      metadata: {
        agentic: {
          buyer: {
            email: 'buyer@example.com',
            first_name: 'Ada',
            last_name: 'Lovelace',
            phone_number: '+2348012345678',
          },
          payment_state: 'payment_pending',
          ...storedCheckoutSnapshot,
        },
      },
    });

    const params = { params: Promise.resolve({ id: 'agentic_session_1' }) };
    const response = await POST(buildCompleteRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(createDedicatedVirtualAccount).not.toHaveBeenCalled();
    expect(createAgenticCheckoutOrder).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
    expect(body).toEqual({
      code: 'AGENTIC_PAYSTACK_DVA_PAUSED',
      error: 'Agentic Paystack bank transfer is paused',
    });
  });

  it('returns existing payment details without requiring fresh authorization', async () => {
    const { updateSpy } = mockSession({
      ...makeReadySession(),
      status: 'processing',
      order_id: 'order-1',
      payment_reference: '1234567890',
      virtual_account_bank: 'Paystack-Titan',
      virtual_account_name: 'Baci Test',
      virtual_account_number: '1234567890',
      metadata: {
        agentic: {
          buyer: {
            email: 'buyer@example.com',
            first_name: 'Ada',
            last_name: 'Lovelace',
            phone_number: '+2348012345678',
          },
          payment_state: 'payment_pending',
          ...storedCheckoutSnapshot,
        },
      },
    });

    const params = { params: Promise.resolve({ id: 'agentic_session_1' }) };
    const response = await POST(
      buildCompleteRequest({ includeAuthorization: false }),
      params
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createDedicatedVirtualAccount).not.toHaveBeenCalled();
    expect(createAgenticCheckoutOrder).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      id: 'agentic_session_1',
      status: 'ready_for_payment',
      order_id: 'order-1',
      payment_details: {
        account_number: '1234567890',
        bank_name: 'Paystack-Titan',
      },
    });
  });

  it('rejects completion before the session is ready for payment side effects', async () => {
    const { updateSpy } = mockSession({
      ...makeReadySession(),
      shipping_address: null,
      status: 'pending',
    });
    mockCalculatedSession();

    const params = { params: Promise.resolve({ id: 'agentic_session_1' }) };
    const response = await POST(buildCompleteRequest(), params);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: 'Session is not ready for payment',
      status: 'not_ready_for_payment',
    });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(createDedicatedVirtualAccount).not.toHaveBeenCalled();
    expect(createAgenticCheckoutOrder).not.toHaveBeenCalled();
  });

  it('does not treat a zero grand total as a missing total', async () => {
    const { updateSpy } = mockSession(makeReadySession());
    mockCalculatedSession({ total: 0 });

    const params = { params: Promise.resolve({ id: 'agentic_session_1' }) };
    const response = await POST(
      buildCompleteRequest({ confirmationAmount: 1 }),
      params
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      code: 'CONFIRMATION_MISMATCH',
      error: 'Checkout authorization invalid',
      retryable: false,
    });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(createDedicatedVirtualAccount).not.toHaveBeenCalled();
    expect(createAgenticCheckoutOrder).not.toHaveBeenCalled();
  });
});
