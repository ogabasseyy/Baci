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
  mockSuccessfulPaymentSessionSupabase,
  makeReadySession,
} = paymentStateTestHelpers;

function makePaymentAccountReadySession() {
  return {
    ...makeReadySession(),
    cart_items: [{ invalid: true }],
    metadata: {
      agentic: {
        dva_account: {
          account_name: 'Baci Test',
          account_number: '1234567890',
          bank_name: 'Paystack-Titan',
        },
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
        payment_state: 'payment_account_ready',
        totals: [{ type: 'total', display_text: 'Total Due', amount: 500000 }],
      },
    },
    payment_reference: '1234567890',
    virtual_account_bank: 'Paystack-Titan',
    virtual_account_name: 'Baci Test',
    virtual_account_number: '1234567890',
  };
}

describe('POST /api/agentic/checkout_sessions/[id]/complete payment-account resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('OPENAI_AGENTIC_CONFIRMATION_KEY', completionConfirmationSecret);
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

  it('resumes stored payment-account state without fresh calculation or authorization', async () => {
    const { updateSpy } = mockSuccessfulPaymentSessionSupabase({
      ...makePaymentAccountReadySession(),
    });
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: { order: { id: 'order-1' }, wallet: null, amountDueToGateway: 0 },
      error: undefined,
      ok: true,
      orderId: 'order-1',
      status: 201,
      statusText: 'Created',
    });

    const { POST } = await import('./route');
    const response = await POST(
      buildCompleteRequest({ includeAuthorization: false }),
      { params: Promise.resolve({ id: 'agentic_session_1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
    // Resume uses the stored DVA snapshot; the subaccount is only needed for fresh account creation.
    expect(createDedicatedVirtualAccount).not.toHaveBeenCalled();
    expect(createAgenticCheckoutOrder).toHaveBeenCalledOnce();
    const writtenPaymentStates = updateSpy.mock.calls.map(
      ([payload]) =>
        (
          payload as {
            metadata?: { agentic?: { payment_state?: unknown } };
          }
        ).metadata?.agentic?.payment_state
    );
    expect(writtenPaymentStates).not.toContain('claiming_payment');
    expect(body).toMatchObject({
      id: 'agentic_session_1',
      order_id: 'order-1',
      payment_details: {
        account_number: '1234567890',
        bank_name: 'Paystack-Titan',
      },
    });
  });

  it('does not resume payment-account-ready state through the normal route while paused', async () => {
    vi.stubEnv('AGENTIC_PAYSTACK_DVA_MODE', 'paused');
    const { updateSpy } = mockSuccessfulPaymentSessionSupabase(
      makePaymentAccountReadySession()
    );

    const { POST } = await import('./route');
    const response = await POST(
      buildCompleteRequest({ includeAuthorization: false }),
      { params: Promise.resolve({ id: 'agentic_session_1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      code: 'AGENTIC_PAYSTACK_DVA_PAUSED',
      error: 'Agentic Paystack bank transfer is paused',
    });
    expect(calculateCheckoutSession).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(createDedicatedVirtualAccount).not.toHaveBeenCalled();
    expect(createAgenticCheckoutOrder).not.toHaveBeenCalled();
  });
});
