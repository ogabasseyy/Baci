import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import { createAgenticCheckoutOrder } from '@/lib/agentic/checkout-order-dispatch';
import { createAgenticCheckoutPaymentAccount } from '@/lib/agentic/checkout-payment-account';
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
import { grandfatheredReplayTestFixtures } from './route-grandfathered-replay-test-support';
import { paymentStateTestHelpers } from './route-payment-state-test-helpers';

const mockVerifyAgenticApiKey = vi.fn(() => true);
const mockResolveAgenticMerchantContext = vi.fn(() =>
  Promise.resolve({
    id: 'merchant-1',
    pay_on_delivery_enabled: true,
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
  resolveAgenticMerchantContext: mockResolveAgenticMerchantContext,
}));
vi.mock('@/lib/agentic/checkout', () => ({
  calculateCheckoutSession: vi.fn(),
}));
vi.mock('@/lib/agentic/checkout-payment-account', () => ({
  createAgenticCheckoutPaymentAccount: vi.fn(),
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
  mockCalculatedSession,
  mockSuccessfulPaymentSessionSupabase,
} = paymentStateTestHelpers;
const { makeSession: makeGrandfatheredSession, makeStoredResponse } =
  grandfatheredReplayTestFixtures;

function expectNoPaymentSideEffects(updateSpy: Mock): void {
  expect(calculateCheckoutSession).not.toHaveBeenCalled();
  expect(updateSpy).not.toHaveBeenCalled();
  expect(createAgenticCheckoutPaymentAccount).not.toHaveBeenCalled();
  expect(createDedicatedVirtualAccount).not.toHaveBeenCalled();
  expect(createAgenticCheckoutOrder).not.toHaveBeenCalled();
}

describe('checkout session complete handler in paused DVA mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AGENTIC_PAYSTACK_DVA_MODE', 'paused');
    vi.stubEnv('OPENAI_AGENTIC_CONFIRMATION_KEY', completionConfirmationSecret);
    vi.mocked(isValidPaystackSubaccountCode).mockReturnValue(true);
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

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    'paystack',
    'paystack_bank_transfer',
  ])('rejects a new %s request before payment side effects', async (provider) => {
    const { updateSpy } = mockSuccessfulPaymentSessionSupabase();

    const { POST } = await import('./route');
    const response = await POST(
      buildCompleteRequest({
        paymentData: { provider, token: 'confirmed-by-human' },
      }),
      { params: Promise.resolve({ id: 'agentic_session_1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      code: 'AGENTIC_PAYSTACK_DVA_PAUSED',
      error: 'Agentic Paystack bank transfer is paused',
    });
    expect(reserveAgenticIdempotencyKey).toHaveBeenCalled();
    expect(reserveAgenticRequestId).toHaveBeenCalled();
    expect(storeAgenticIdempotencyResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        response: body,
        route: 'checkout_sessions.complete',
        status: 409,
      })
    );
    expectNoPaymentSideEffects(updateSpy);
  });

  it('returns an exact stored idempotency replay before the pause gate', async () => {
    const storedResponse = makeStoredResponse();
    const { updateSpy } = mockSuccessfulPaymentSessionSupabase(
      makeGrandfatheredSession()
    );
    vi.mocked(reserveAgenticIdempotencyKey).mockResolvedValueOnce({
      ok: true,
      requestHash: 'a'.repeat(64),
      response: storedResponse,
      state: 'replay',
      status: 200,
    });

    const { POST } = await import('./route');
    const response = await POST(buildCompleteRequest(), {
      params: Promise.resolve({ id: 'agentic_session_1' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(storedResponse);
    expect(reserveAgenticRequestId).not.toHaveBeenCalled();
    expect(storeAgenticIdempotencyResponse).not.toHaveBeenCalled();
    expectNoPaymentSideEffects(updateSpy);
  });

  it('rejects an exact request replay when the stored account identity drifted', async () => {
    const storedResponse = makeStoredResponse();
    const { updateSpy } = mockSuccessfulPaymentSessionSupabase(
      makeGrandfatheredSession({ virtual_account_number: '9999999999' })
    );
    vi.mocked(reserveAgenticIdempotencyKey).mockResolvedValueOnce({
      ok: true,
      requestHash: 'a'.repeat(64),
      response: storedResponse,
      state: 'replay',
      status: 200,
    });

    const { POST } = await import('./route');
    const response = await POST(buildCompleteRequest(), {
      params: Promise.resolve({ id: 'agentic_session_1' }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'AGENTIC_PAYSTACK_DVA_PAUSED',
      error: 'Agentic Paystack bank transfer is paused',
    });
    expect(reserveAgenticRequestId).not.toHaveBeenCalled();
    expect(storeAgenticIdempotencyResponse).not.toHaveBeenCalled();
    expectNoPaymentSideEffects(updateSpy);
  });

  it('leaves pay on delivery available', async () => {
    mockSuccessfulPaymentSessionSupabase();
    mockCalculatedSession();
    vi.mocked(createAgenticCheckoutOrder).mockResolvedValue({
      data: {
        amountDueToGateway: 0,
        order: { id: 'order-pod-1' },
        wallet: null,
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

    expect(response.status).toBe(200);
    expect(createAgenticCheckoutPaymentAccount).not.toHaveBeenCalled();
    expect(createDedicatedVirtualAccount).not.toHaveBeenCalled();
    expect(createAgenticCheckoutOrder).toHaveBeenCalledWith(
      expect.objectContaining({ payment_method: 'pay_on_delivery' }),
      expect.any(Object),
      { boundPrincipalId: null }
    );
  });
});
