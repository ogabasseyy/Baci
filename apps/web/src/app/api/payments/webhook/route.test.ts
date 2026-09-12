import { createHmac } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const mockConfirmAgenticPaystackDvaPayment = vi.hoisted(() => vi.fn());
const mockGetPaystackDvaReceiverAccountNumber = vi.hoisted(() => vi.fn());
const mockMarkAgenticPaystackDvaSessionPaid = vi.hoisted(() => vi.fn());
const mockConfirmPaystackWalletDvaTopUp = vi.hoisted(() => vi.fn());
const mockCreditWalletTopUp = vi.hoisted(() => vi.fn());
const mockNotifyWalletCredited = vi.hoisted(() => vi.fn());
const mockHandlePaystackSavingsWebhookTransaction = vi.hoisted(() => vi.fn());
const mockProcessMerchantInvoicePartialPayment = vi.hoisted(() => vi.fn());
const mockProcessWalletFundedOrderPayment = vi.hoisted(() => vi.fn());
const mockRunPaidOrderSideEffects = vi.hoisted(() => vi.fn());
const mockPersistMerchantWalletAssignmentEvent = vi.hoisted(() => vi.fn());
const mockFailMerchantWalletAssignmentEvent = vi.hoisted(() => vi.fn());
const mockCaptureOrHoldRedvaultPayment = vi.hoisted(() => vi.fn());

// Mock environment variables
vi.mock('@/env', () => ({
  env: {
    KORAPAY_SECRET_KEY: 'test-korapay-secret',
    PAYSTACK_SECRET_KEY: 'test-paystack-secret',
    NEXT_PUBLIC_ROOT_DOMAIN: 'usebaci.com',
  },
}));

vi.mock('@/lib/agentic/paystack-dva-webhook', () => ({
  confirmAgenticPaystackDvaPayment: mockConfirmAgenticPaystackDvaPayment,
  getPaystackDvaReceiverAccountNumber: mockGetPaystackDvaReceiverAccountNumber,
}));

vi.mock('@/lib/agentic/paystack-dva-session-paid', () => ({
  markAgenticPaystackDvaSessionPaid: mockMarkAgenticPaystackDvaSessionPaid,
}));

vi.mock('@/lib/payments/confirm-paystack-wallet-dva-top-up', () => ({
  confirmPaystackWalletDvaTopUp: mockConfirmPaystackWalletDvaTopUp,
}));

vi.mock('@/lib/payments/process-wallet-funded-order-payment', () => ({
  processWalletFundedOrderPayment: mockProcessWalletFundedOrderPayment,
}));

vi.mock('@/lib/payments/process-merchant-invoice-partial-payment', () => ({
  processMerchantInvoicePartialPayment:
    mockProcessMerchantInvoicePartialPayment,
}));

vi.mock('@/lib/payments/run-paid-order-side-effects', () => ({
  runPaidOrderSideEffects: mockRunPaidOrderSideEffects,
}));
vi.mock('@/lib/payments/redvault-capture-hold', () => ({
  captureOrHoldRedvaultPayment: (...args: unknown[]) =>
    mockCaptureOrHoldRedvaultPayment(...args),
}));
vi.mock('@/lib/persist-merchant-wallet-assignment-event', () => ({
  persistMerchantWalletAssignmentEvent:
    mockPersistMerchantWalletAssignmentEvent,
}));
vi.mock('@/lib/merchant-wallet-assignment-events', () => ({
  failMerchantWalletAssignmentEvent: mockFailMerchantWalletAssignmentEvent,
}));

vi.mock('@/lib/customer-savings-paystack-webhook', () => ({
  createVerifiedPaystackWebhookSignature: (isVerified: boolean) =>
    isVerified ? { verified: true } : null,
  handlePaystackSavingsWebhookTransaction:
    mockHandlePaystackSavingsWebhookTransaction,
}));

// Mock Next.js headers
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => Promise.resolve(new Map())),
}));

// Mock Next.js server with after function
vi.mock('next/server', async () => {
  const actual = await vi.importActual('next/server');
  return {
    ...actual,
    after: vi.fn((callback: () => Promise<void>) => {
      // Execute callback immediately in tests (not in background)
      callback().catch(() => {
        // Ignore errors in background tasks
      });
    }),
  };
});

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Supabase clients - create fresh mocks for each test
// We need to track multiple calls to from() for different tables
let mockSupabaseClient: any;
let mockServiceClient: any;

function createMockSupabaseClient() {
  return {
    auth: {
      getUser: vi.fn(),
    },
    from: vi.fn((_table: string) => {
      // Create a new chain for each table call
      const chain = {
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        // The finalizer's pure-replay guard checks payment_side_effects via
        // .select().eq().limit(); default to "outbox history exists" so
        // replay tests keep exercising the drain path.
        limit: vi.fn().mockResolvedValue({
          data: [{ order_id: 'order-123', transaction_id: 'txn-123' }],
          error: null,
        }),
      };
      return chain;
    }),
    // A1: rpc() must be both awaitable AND have a `.single()` chain method
    // so the new claim_payment_side_effect call (`supabase.rpc(...).single()`
    // in apply-paid-order-side-effects.ts) doesn't crash. The default
    // claim response is `we_won: true` so the helper proceeds to the
    // executor; existing `record_merchant_settlement` callers still get
    // `{data: null, error: null}` via either await form.
    //
    // `complete_order_gateway_payment` is the atomic RPC backing
    // finalizeOrderGatewayPayment. Tests that reach the order-finalizer path
    // without overriding rpc() themselves get this default "healthy, order
    // updated" completion shape so they don't have to each re-declare it;
    // tests asserting a specific completion outcome (cancelled, already-paid
    // replay, RPC failure, etc.) still override rpc() explicitly.
    rpc: vi.fn((name: string, _args?: unknown) => {
      let data: unknown = null;
      if (name === 'claim_payment_side_effect') {
        data = { we_won: true, current_status: 'claimed' };
      } else if (name === 'complete_order_gateway_payment') {
        data = {
          actor: null,
          already_completed: false,
          order_already_paid: false,
          order_updated: true,
          order_cancelled: false,
          order_skipped_status: null,
          previous_payment_status: 'pending',
          previous_shipping_status: 'pending',
          payment_status: 'paid',
          shipping_status: 'processing',
          cancelled_at: null,
          order_number: 'ORD-TEST-DEFAULT',
        };
      }
      const result = { data, error: null };
      const chain = Object.assign(Promise.resolve(result), {
        single: () => Promise.resolve(result),
      });
      return chain;
    }),
  };
}

// Create initial mocks
mockSupabaseClient = createMockSupabaseClient();
mockServiceClient = createMockSupabaseClient();

/** The query-chain shape `mockServiceClient.from` is typed to return. */
type MockedQueryChain = ReturnType<typeof mockServiceClient.from>;

/**
 * Narrows a partial query-chain stub to the mocked `from` return type without
 * `any`: the stub only implements the chain methods the code under test calls.
 */
function asMockedQueryChain(chain: Record<string, unknown>): MockedQueryChain {
  return chain as unknown as MockedQueryChain;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn((cookieStore?: any) => {
    // Support both signatures: createClient() and createClient(cookieStore)
    if (cookieStore) {
      // Synchronous return for createClient(cookieStore)
      return mockSupabaseClient;
    }
    // Async return for createClient()
    return Promise.resolve(mockSupabaseClient);
  }),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => mockServiceClient),
}));

// handlePaymentForCancelledOrder files the reconciliation row through a
// service-role admin client (reconciliation_review is RLS-locked to
// service_role), not the route's own service client.
const mockReconciliationInsert = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: null, error: null })
);
const mockClaimWalletCreditPush = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ status: 'claimed' })
);
const mockReleaseWalletCreditPush = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ status: 'released' })
);
vi.mock('@/lib/payments/claim-wallet-credit-push', () => ({
  claimWalletCreditPush: (...args: unknown[]) =>
    mockClaimWalletCreditPush(...args),
}));
vi.mock('@/lib/payments/release-wallet-credit-push', () => ({
  releaseWalletCreditPush: (...args: unknown[]) =>
    mockReleaseWalletCreditPush(...args),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'reconciliation_review') {
        return { insert: mockReconciliationInsert };
      }
      throw new Error(`Unexpected admin table: ${table}`);
    }),
  })),
}));

// Mock payment gateways
vi.mock('@/lib/korapay', () => ({
  verifyPayment: vi.fn(),
}));

vi.mock('@/lib/paystack', () => ({
  verifyTransaction: vi.fn(),
  calculatePlatformFee: vi.fn(() => ({
    platformFee: 2000, // 20 NGN in kobo
  })),
}));

// Mock email and notifications
vi.mock('@/lib/email-templates', () => ({
  generateOrderConfirmationEmail: vi.fn(() => '<html>Email</html>'),
  generateOrderConfirmationText: vi.fn(() => 'Email text'),
}));

vi.mock('@/lib/expo-push', () => ({
  notifyNewOrder: vi.fn(),
  notifyPaymentReceived: vi.fn(),
}));

vi.mock('@/lib/zeptomail', () => ({
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/go54', () => ({
  isGo54Configured: vi.fn(() => true),
  registerDomain: vi.fn(),
}));

// The domain repair/fulfillment success paths call these; the real
// implementations touch Next.js revalidation APIs that throw outside a
// request context.
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateMerchantFeed: vi.fn(),
}));

vi.mock('@/lib/edge-config-sync', () => ({
  // Must resolve: the next/server `after` mock chains .catch on the result.
  triggerDomainEdgeConfigSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/trigger-purchase-conversion', () => ({
  triggerPurchaseConversion: vi.fn(),
}));

vi.mock('@/lib/customer-saved-payment-methods', () => ({
  upsertPaystackAuthorization: vi.fn(),
}));

vi.mock('@/lib/customer-wallet-top-up', () => ({
  creditWalletTopUp: mockCreditWalletTopUp,
  WALLET_TOP_UP_TRANSACTION_TYPE: 'wallet_topup',
}));

vi.mock('@/lib/payments/notify-wallet-credited', () => ({
  notifyWalletCredited: mockNotifyWalletCredited,
}));

vi.mock('@/lib/vtu-fulfillment', () => ({
  fulfillPendingVtuTransaction: vi.fn(() =>
    Promise.resolve({
      status: 'successful',
      reference: 'VTU-123',
      amount: 1000,
    })
  ),
}));

// Mock payment schemas
vi.mock('@/schemas/payments', () => ({
  paystackZeroCandidateReviewGatewayResponseSchema: {
    safeParse: vi.fn((value: unknown) => {
      const response =
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)
          : {};
      const customer =
        response.customer &&
        typeof response.customer === 'object' &&
        !Array.isArray(response.customer)
          ? (response.customer as Record<string, unknown>)
          : {};

      return {
        data: {
          ...response,
          channel:
            typeof response.channel === 'string' ? response.channel : null,
          customer: {
            email: typeof customer.email === 'string' ? customer.email : null,
          },
          paid_at:
            typeof response.paid_at === 'string' ? response.paid_at : null,
        },
        success: true,
      };
    }),
  },
  referenceSchema: {
    safeParse: vi.fn((value: unknown) => {
      if (typeof value === 'string' && value.length > 0) {
        return { success: true, data: value };
      }
      return { success: false, error: { message: 'Invalid reference' } };
    }),
  },
}));

// Helper to create HMAC signature
function createSignature(payload: string, secret: string): string {
  return createHmac('sha512', secret).update(payload).digest('hex');
}

function createKorapaySignature(
  data: Record<string, unknown>,
  secret: string
): string {
  return createHmac('sha256', secret)
    .update(JSON.stringify(data))
    .digest('hex');
}

// Helper to create mock request
function createMockRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): NextRequest {
  const bodyString = JSON.stringify(body);
  const url = 'https://example.com/api/payments/webhook';

  return {
    text: vi.fn(() => Promise.resolve(bodyString)),
    json: vi.fn(() => Promise.resolve(body)),
    headers: new Headers(headers),
    url,
  } as unknown as NextRequest;
}

// Helper to setup service client for successful transaction processing
function setupSuccessfulTransactionMocks(
  transactionData: Record<string, unknown> = {},
  options: { updatedTransaction?: Record<string, unknown> | null } = {}
) {
  const defaultTransaction = {
    id: 'txn-123',
    merchant_id: 'merchant-123',
    amount: '1000',
    currency: 'NGN',
    gateway_reference: 'REF123',
    status: 'pending',
    order_id: null,
    metadata: {},
    ...transactionData,
  };

  // Mock the from() method to return different chains based on table name
  vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
    if (table === 'transactions') {
      // First call: .select().eq().single() for transaction lookup
      const selectChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: defaultTransaction,
          error: null,
        }),
      };

      // Second call: .update().eq().neq().select().maybeSingle() for transaction
      // update; the domain fulfillment claim additionally chains `.is(...)`
      // and `.or(...)`.
      const updateChain = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data:
            'updatedTransaction' in options
              ? options.updatedTransaction
              : { id: 'txn-123' },
          error: null,
        }),
      };

      // Track call count to return appropriate chain
      let _callCount = 0;
      return {
        select: vi.fn(() => {
          _callCount++;
          return selectChain;
        }),
        update: vi.fn(() => updateChain),
      } as any;
    }

    // Default chain for other tables
    return {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
  });

  // Mock RPC: chainable shape so the A1 outbox helper's
  // `.rpc('claim_payment_side_effect', ...).single()` works alongside
  // the existing `.rpc('record_merchant_settlement', ...)` await form.
  // `complete_order_gateway_payment` gets the same default "healthy, order
  // updated" completion as createMockSupabaseClient()'s default, for tests
  // in this file that route an order_id through setupSuccessfulTransactionMocks.
  vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
    let data: unknown = null;
    if (name === 'claim_payment_side_effect') {
      data = { we_won: true, current_status: 'claimed' };
    } else if (name === 'complete_order_gateway_payment') {
      data = {
        actor: null,
        already_completed: false,
        order_already_paid: false,
        order_updated: true,
        order_cancelled: false,
        order_skipped_status: null,
        previous_payment_status: 'pending',
        previous_shipping_status: 'pending',
        payment_status: 'paid',
        shipping_status: 'processing',
        cancelled_at: null,
        order_number: 'ORD-TEST-DEFAULT',
      };
    }
    const result = { data, error: null };
    return Object.assign(Promise.resolve(result), {
      single: () => Promise.resolve(result),
    }) as never;
  });
}

describe('POST /api/payments/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClaimWalletCreditPush.mockResolvedValue({ status: 'claimed' });
    // Reset the mock clients
    mockServiceClient = createMockSupabaseClient();
    mockSupabaseClient = createMockSupabaseClient();
    process.env.KORAPAY_SECRET_KEY = 'test-korapay-secret';
    process.env.PAYSTACK_SECRET_KEY = 'test-paystack-secret';
    mockConfirmAgenticPaystackDvaPayment.mockResolvedValue({
      handled: false,
    });
    mockConfirmPaystackWalletDvaTopUp.mockResolvedValue({ kind: 'none' });
    mockProcessMerchantInvoicePartialPayment.mockResolvedValue({
      kind: 'none',
    });
    mockProcessWalletFundedOrderPayment.mockResolvedValue({ kind: 'none' });
    mockCaptureOrHoldRedvaultPayment.mockResolvedValue({
      kind: 'not_redvault',
    });
    mockRunPaidOrderSideEffects.mockResolvedValue({
      concurrentTakeoverSteps: [],
      failedSteps: [],
      ranSteps: ['paid_email', 'merchant_settlement'],
      skippedSteps: [],
    });
    mockCreditWalletTopUp.mockResolvedValue({
      balance: 20000,
      firstCredit: true,
      reference: 'REF123',
      transactionId: 'wallet-credit-1',
    });
    mockNotifyWalletCredited.mockResolvedValue({ status: 'sent' });
    mockHandlePaystackSavingsWebhookTransaction.mockResolvedValue(null);
    mockFailMerchantWalletAssignmentEvent.mockResolvedValue({
      kind: 'match',
    });
    mockGetPaystackDvaReceiverAccountNumber.mockReturnValue(null);
    mockMarkAgenticPaystackDvaSessionPaid.mockResolvedValue({
      ok: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records a DVA invoice underpayment before the full paid-order finalizer', async () => {
    const body = {
      event: 'charge.success',
      data: {
        authorization: {
          receiver_bank_account_number: '9812858131',
        },
        reference: 'PSK-PARTIAL-1',
      },
    };
    const bodyString = JSON.stringify(body);
    const request = createMockRequest(body, {
      'x-paystack-signature': createSignature(
        bodyString,
        'test-paystack-secret'
      ),
    });

    const { verifyTransaction } = await import('@/lib/paystack');
    vi.mocked(verifyTransaction).mockResolvedValue({
      success: true,
      data: {
        amount: 30_000_000,
        channel: 'dedicated_nuban',
        created_at: '2026-08-05T08:29:00Z',
        currency: 'NGN',
        customer: {
          customer_code: 'CUS_partial',
          email: 'customer@example.com',
          first_name: 'Customer',
          id: 1,
          last_name: null,
          phone: null,
        },
        fees: 100_000,
        fees_split: null,
        id: 1,
        metadata: null,
        paid_at: '2026-08-05T08:30:00Z',
        reference: 'PSK-PARTIAL-1',
        status: 'success',
      },
    });
    mockGetPaystackDvaReceiverAccountNumber.mockReturnValue('9812858131');
    const partialTransaction = {
      amount: 300_000,
      currency: 'NGN',
      gateway_reference: 'PSK-PARTIAL-1',
      id: 'txn-partial-1',
      merchant_id: 'merchant-1',
      metadata: {
        order_payment_allocation: 'merchant_invoice_partial',
      },
      order_id: 'order-1',
      platform_fee: 0,
    };
    mockConfirmAgenticPaystackDvaPayment.mockResolvedValueOnce({
      handled: false,
      transaction: partialTransaction,
    });
    mockProcessMerchantInvoicePartialPayment.mockResolvedValueOnce({
      body: {
        amountPaid: 300_000,
        balanceDue: 535_000,
        message: 'Merchant invoice partial payment recorded',
        orderNumber: 'ORD-1',
        success: true,
      },
      kind: 'processed',
      status: 200,
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      amountPaid: 300_000,
      balanceDue: 535_000,
      success: true,
    });
    expect(mockProcessMerchantInvoicePartialPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway: 'paystack',
        reference: 'PSK-PARTIAL-1',
        transaction: partialTransaction,
      })
    );
    expect(mockServiceClient.rpc).not.toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      expect.anything()
    );
    expect(mockRunPaidOrderSideEffects).not.toHaveBeenCalled();
  });

  it('acknowledges a held REDVAULT capture without a paid or settlement signal', async () => {
    const body = {
      data: { reference: 'PSK-REDVAULT-HELD' },
      event: 'charge.success',
    };
    const bodyString = JSON.stringify(body);
    const request = createMockRequest(body, {
      'x-paystack-signature': createSignature(
        bodyString,
        'test-paystack-secret'
      ),
    });
    const { verifyTransaction } = await import('@/lib/paystack');
    vi.mocked(verifyTransaction).mockResolvedValue({
      data: {
        amount: 100_000,
        currency: 'NGN',
        reference: 'PSK-REDVAULT-HELD',
        status: 'success',
      } as never,
      success: true,
    });
    setupSuccessfulTransactionMocks({
      amount: '1000',
      gateway_reference: 'PSK-REDVAULT-HELD',
      order_id: 'order-redvault-1',
    });
    mockCaptureOrHoldRedvaultPayment.mockResolvedValue({
      duplicate: false,
      kind: 'captured_held',
      reason: 'provider_eligibility_evidence_unavailable',
    });

    const response = await POST(request);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      code: 'REDVAULT_CAPTURE_HELD',
      error: 'Payment capture is pending eligibility confirmation',
      status: 'pending',
    });
    expect(mockServiceClient.rpc).not.toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      expect.anything()
    );
    expect(mockServiceClient.rpc).not.toHaveBeenCalledWith(
      'record_merchant_settlement',
      expect.anything()
    );
  });

  it('fails closed without settlement when REDVAULT capture persistence fails', async () => {
    const body = {
      data: { reference: 'PSK-REDVAULT-HOLD-ERROR' },
      event: 'charge.success',
    };
    const bodyString = JSON.stringify(body);
    const request = createMockRequest(body, {
      'x-paystack-signature': createSignature(
        bodyString,
        'test-paystack-secret'
      ),
    });
    const { verifyTransaction } = await import('@/lib/paystack');
    vi.mocked(verifyTransaction).mockResolvedValue({
      data: {
        amount: 100_000,
        currency: 'NGN',
        reference: 'PSK-REDVAULT-HOLD-ERROR',
        status: 'success',
      } as never,
      success: true,
    });
    setupSuccessfulTransactionMocks({
      amount: '1000',
      gateway_reference: 'PSK-REDVAULT-HOLD-ERROR',
      order_id: 'order-redvault-hold-error',
    });
    mockCaptureOrHoldRedvaultPayment.mockRejectedValue(
      new Error('redvault_capture_hold_rpc_missing')
    );

    const response = await POST(request);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: 'ORDER_PAYMENT_COMPLETION_FAILED',
      error: 'Order payment completion failed',
    });
    expect(mockServiceClient.rpc).not.toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      expect.anything()
    );
    expect(mockServiceClient.rpc).not.toHaveBeenCalledWith(
      'record_merchant_settlement',
      expect.anything()
    );
  });

  it('does not settle a completed DVA transaction whose locked invoice balance changed', async () => {
    const body = {
      event: 'charge.success',
      data: {
        authorization: {
          receiver_bank_account_number: '9812858131',
        },
        reference: 'PSK-STALE-EXACT-1',
      },
    };
    const request = createMockRequest(body, {
      'x-paystack-signature': createSignature(
        JSON.stringify(body),
        'test-paystack-secret'
      ),
    });
    const { verifyTransaction } = await import('@/lib/paystack');
    vi.mocked(verifyTransaction).mockResolvedValue({
      success: true,
      data: {
        amount: 53_500_000,
        channel: 'dedicated_nuban',
        created_at: '2026-08-05T08:29:00Z',
        currency: 'NGN',
        customer: {
          customer_code: 'CUS_stale_exact',
          email: 'customer@example.com',
          first_name: 'Customer',
          id: 1,
          last_name: null,
          phone: null,
        },
        fees: 100_000,
        fees_split: null,
        id: 1,
        metadata: null,
        paid_at: '2026-08-05T08:30:00Z',
        reference: 'PSK-STALE-EXACT-1',
        status: 'success',
      },
    });
    const transaction = {
      amount: 535_000,
      currency: 'NGN',
      gateway_reference: 'PSK-STALE-EXACT-1',
      id: 'txn-stale-exact-1',
      merchant_id: 'merchant-1',
      metadata: {
        order_payment_allocation: 'merchant_invoice_partial',
      },
      order_id: 'order-1',
      platform_fee: 2_050,
      status: 'pending',
    };
    mockConfirmAgenticPaystackDvaPayment.mockResolvedValueOnce({
      handled: false,
      transaction,
    });
    vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
      if (table !== 'transactions') {
        throw new Error(`Unexpected table after balance review: ${table}`);
      }
      return {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: transaction.id },
          error: null,
        }),
      } as never;
    });
    vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
      const result = {
        data:
          name === 'complete_order_gateway_payment'
            ? {
                error_code: 'MERCHANT_INVOICE_PARTIAL_BALANCE_CHANGED',
                transaction_status: 'completed',
              }
            : null,
        error: null,
      };
      return Object.assign(Promise.resolve(result), {
        single: () => Promise.resolve(result),
      }) as never;
    });

    const response = await POST(request);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: 'MERCHANT_INVOICE_PARTIAL_BALANCE_CHANGED',
      error: 'Payment requires reconciliation review',
    });
    expect(mockServiceClient.rpc).not.toHaveBeenCalledWith(
      'record_merchant_settlement',
      expect.anything()
    );
    expect(mockRunPaidOrderSideEffects).not.toHaveBeenCalled();
  });

  describe('Signature Verification', () => {
    it('returns 401 when Korapay signature is invalid', async () => {
      const body = {
        reference: 'REF123',
        status: 'success',
        event: 'charge.success',
      };

      const request = createMockRequest(body, {
        'x-korapay-signature': 'invalid-signature',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: 'Invalid signature' });
    });

    it('returns 401 when Paystack signature is invalid', async () => {
      const body = {
        event: 'charge.success',
        data: {
          reference: 'REF123',
        },
      };

      const request = createMockRequest(body, {
        'x-paystack-signature': 'invalid-signature',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: 'Invalid signature' });
    });

    it('returns 401 when signature header is missing', async () => {
      const body = {
        reference: 'REF123',
        status: 'success',
      };

      const request = createMockRequest(body);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: 'Invalid signature' });
    });

    it('accepts valid Korapay signature', async () => {
      const body = {
        reference: 'REF123',
        status: 'success',
        event: 'charge.success',
        amount: 1000,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');

      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      // Mock successful payment verification
      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 1000,
          reference: 'REF123',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      // Setup successful transaction mocks
      setupSuccessfulTransactionMocks();

      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it('accepts valid Korapay signature when reference is nested in data', async () => {
      const body = {
        event: 'charge.success',
        data: {
          reference: 'REF123',
          status: 'success',
          amount: 1000,
          currency: 'NGN',
        },
      };
      const signature = createKorapaySignature(
        body.data,
        'test-korapay-secret'
      );

      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 1000,
          reference: 'REF123',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      setupSuccessfulTransactionMocks();

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(verifyPayment).toHaveBeenCalledWith('REF123');
    });

    it('accepts valid Paystack signature', async () => {
      const body = {
        event: 'charge.success',
        data: {
          reference: 'REF123',
          amount: 100000, // Paystack uses kobo
        },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');

      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      // Mock successful payment verification
      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          id: 1,
          status: 'success',
          amount: 100000,
          reference: 'REF123',
          currency: 'NGN',
          channel: 'card',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: {
            id: 1,
            email: 'test@example.com',
            customer_code: 'CUS_test',
            first_name: null,
            last_name: null,
            phone: null,
          },
          metadata: null,
          fees: 150,
          fees_split: null,
        },
      });

      // Setup successful transaction mocks (Paystack amount is in kobo, so 100000 kobo = 1000 NGN)
      setupSuccessfulTransactionMocks({ amount: '1000' });

      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe('JSON Parsing', () => {
    it('returns 400 when JSON body is invalid', async () => {
      const url = 'https://example.com/api/payments/webhook';
      const invalidJson = 'not-valid-json';
      const signature = createSignature(invalidJson, 'test-korapay-secret');

      const request = {
        text: vi.fn(() => Promise.resolve(invalidJson)),
        json: vi.fn(() => Promise.reject(new Error('Invalid JSON'))),
        headers: new Headers({
          'x-korapay-signature': signature,
        }),
        url,
      } as unknown as NextRequest;

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Invalid JSON body' });
    });
  });

  describe('Event Filtering', () => {
    it('ignores non-success Korapay events', async () => {
      const body = {
        reference: 'REF123',
        status: 'failed',
        event: 'charge.failed',
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');

      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ message: 'Event ignored' });
    });

    it('ignores non-success Paystack events', async () => {
      const body = {
        event: 'charge.failed',
        data: {
          reference: 'REF123',
        },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');

      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ message: 'Event ignored' });
    });

    it('processes Korapay event with status=success', async () => {
      const body = {
        reference: 'REF123',
        status: 'success',
        amount: 1000,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');

      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 1000,
          reference: 'REF123',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      setupSuccessfulTransactionMocks();

      const response = await POST(request);

      expect(response.status).toBe(200);
    });
  });

  describe('Domain purchase settlement', () => {
    it('never records a merchant settlement for a domain purchase (review #2991 P1 regression test)', async () => {
      // record_merchant_settlement credits the merchant wallet with
      // gross - gateway_fee - platform_fee. A domain purchase is the merchant
      // BUYING a service from Baci (platform_fee = markup only), so settling
      // would refund the merchant roughly the registrar cost of the domain
      // they just paid for.
      const body = {
        reference: 'DOM-REGRESSION1',
        status: 'success',
        event: 'charge.success',
        amount: 19499,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 19499,
          reference: 'DOM-REGRESSION1',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      setupSuccessfulTransactionMocks({
        amount: '19499',
        gateway_reference: 'DOM-REGRESSION1',
        metadata: {
          transaction_type: 'domain_purchase',
          domain: 'junglee.com',
          tld: '.com',
          years: 1,
          cost_price: 16000,
          sell_price: 19499,
        },
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockServiceClient.rpc).not.toHaveBeenCalledWith(
        'record_merchant_settlement',
        expect.anything()
      );
    });

    it('defers to gateway retry (503, no registrar call) when another path holds the claim (review #2991 P1 regression test)', async () => {
      // The dashboard callback (/api/domains/purchase) and this webhook can
      // both observe the same completed, unused transaction. Whoever loses the
      // atomic metadata claim must NOT call the registrar, or one payment
      // would register (and pay the registrar for) the domain twice. The
      // loser fails the delivery (503) so the gateway retries later — if the
      // dashboard claimant died or released, the retry fulfills; once
      // fulfilled, the retry no-ops.
      const body = {
        reference: 'DOM-REGRESSION2',
        status: 'success',
        event: 'charge.success',
        amount: 19499,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 19499,
          reference: 'DOM-REGRESSION2',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      const domainTransaction = {
        id: 'txn-dom-2',
        merchant_id: 'merchant-123',
        amount: '19499',
        currency: 'NGN',
        gateway_reference: 'DOM-REGRESSION2',
        status: 'pending',
        order_id: null,
        metadata: {
          transaction_type: 'domain_purchase',
          domain: 'junglee.com',
          tld: '.com',
          years: 1,
        },
      };

      // The fulfillment claim is the only update chain that uses `.or(...)`:
      // resolve it to null (another path already claimed); all other update
      // chains keep succeeding.
      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          const selectChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: domainTransaction,
              error: null,
            }),
          };
          return {
            select: vi.fn(() => selectChain),
            update: vi.fn(() => {
              let claimAttempt = false;
              const chain = {
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn().mockReturnThis(),
                is: vi.fn().mockReturnThis(),
                or: vi.fn(() => {
                  claimAttempt = true;
                  return chain;
                }),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn(() =>
                  Promise.resolve({
                    data: claimAttempt ? null : { id: 'txn-dom-2' },
                    error: null,
                  })
                ),
              };
              return chain;
            }),
          } as never;
        }
        if (table === 'merchants') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                business_name: 'Test Store',
                email: 'owner@example.com',
                address: '1 Test Rd',
                city: 'Lagos',
                state: 'Lagos',
                phone: '+2348000000000',
                users: { first_name: 'Test', last_name: 'Owner' },
              },
              error: null,
            }),
          } as never;
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as never;
      });
      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        const data =
          name === 'claim_payment_side_effect'
            ? { we_won: true, current_status: 'claimed' }
            : null;
        const result = { data, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const { registerDomain } = await import('@/lib/go54');

      const response = await POST(request);

      expect(response.status).toBe(503);
      expect(registerDomain).not.toHaveBeenCalled();
      expect(mockServiceClient.rpc).not.toHaveBeenCalledWith(
        'record_merchant_settlement',
        expect.anything()
      );
    });

    it('fails the webhook delivery (500) when the fulfillment claim write errors (review #2991 P2 regression test)', async () => {
      // A transient claim-write failure must NOT be treated like a contested
      // claim: the handler would report success and this paid purchase would
      // silently never be fulfilled. Failing the delivery makes the gateway
      // retry the webhook.
      const body = {
        reference: 'DOM-REGRESSION3',
        status: 'success',
        event: 'charge.success',
        amount: 19499,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 19499,
          reference: 'DOM-REGRESSION3',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      const domainTransaction = {
        id: 'txn-dom-3',
        merchant_id: 'merchant-123',
        amount: '19499',
        currency: 'NGN',
        gateway_reference: 'DOM-REGRESSION3',
        status: 'pending',
        order_id: null,
        metadata: {
          transaction_type: 'domain_purchase',
          domain: 'junglee.com',
          tld: '.com',
          years: 1,
        },
      };

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          const selectChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: domainTransaction,
              error: null,
            }),
          };
          return {
            select: vi.fn(() => selectChain),
            update: vi.fn(() => {
              let claimAttempt = false;
              const chain = {
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn().mockReturnThis(),
                is: vi.fn().mockReturnThis(),
                or: vi.fn(() => {
                  claimAttempt = true;
                  return chain;
                }),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn(() =>
                  Promise.resolve(
                    claimAttempt
                      ? { data: null, error: { message: 'network blip' } }
                      : { data: { id: 'txn-dom-3' }, error: null }
                  )
                ),
              };
              return chain;
            }),
          } as never;
        }
        if (table === 'merchants') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                business_name: 'Test Store',
                email: 'owner@example.com',
                address: '1 Test Rd',
                city: 'Lagos',
                state: 'Lagos',
                phone: '+2348000000000',
                users: { first_name: 'Test', last_name: 'Owner' },
              },
              error: null,
            }),
          } as never;
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as never;
      });
      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        const data =
          name === 'claim_payment_side_effect'
            ? { we_won: true, current_status: 'claimed' }
            : null;
        const result = { data, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const { registerDomain } = await import('@/lib/go54');

      const response = await POST(request);

      expect(response.status).toBe(500);
      expect(registerDomain).not.toHaveBeenCalled();
    });

    it('re-enters fulfillment on retries for a completed-but-unfulfilled purchase (review #2991 P2 regression test)', async () => {
      // The dashboard callback can complete the payment and then die before
      // registration, and a claim-write error 500 makes the gateway retry.
      // In both cases the retry arrives with status already "completed" — the
      // already-processed path must still attempt domain fulfillment instead
      // of returning early and stranding a paid domain.
      const body = {
        reference: 'DOM-REGRESSION4',
        status: 'success',
        event: 'charge.success',
        amount: 19499,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 19499,
          reference: 'DOM-REGRESSION4',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      const domainTransaction = {
        id: 'txn-dom-4',
        merchant_id: 'merchant-123',
        amount: '19499',
        currency: 'NGN',
        gateway_reference: 'DOM-REGRESSION4',
        status: 'completed',
        order_id: null,
        metadata: {
          transaction_type: 'domain_purchase',
          domain: 'junglee.com',
          tld: '.com',
          years: 1,
        },
      };

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          const selectChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: domainTransaction,
              error: null,
            }),
          };
          return {
            select: vi.fn(() => selectChain),
            update: vi.fn(() => {
              let statusIdempotencyUpdate = false;
              const chain = {
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn(() => {
                  // Only the completion update chains .neq('status', ...):
                  // report "no row updated" = already completed.
                  statusIdempotencyUpdate = true;
                  return chain;
                }),
                is: vi.fn().mockReturnThis(),
                or: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn(() =>
                  Promise.resolve({
                    data: statusIdempotencyUpdate ? null : { id: 'txn-dom-4' },
                    error: null,
                  })
                ),
              };
              return chain;
            }),
          } as never;
        }
        if (table === 'merchants') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                business_name: 'Test Store',
                email: 'owner@example.com',
                address: '1 Test Rd',
                city: 'Lagos',
                state: 'Lagos',
                phone: '+2348000000000',
                users: { first_name: 'Test', last_name: 'Owner' },
              },
              error: null,
            }),
          } as never;
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as never;
      });
      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        const data =
          name === 'claim_payment_side_effect'
            ? { we_won: true, current_status: 'claimed' }
            : null;
        const result = { data, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const { registerDomain } = await import('@/lib/go54');
      vi.mocked(registerDomain).mockResolvedValue({
        success: false,
        error: 'registrar unavailable',
      } as never);

      const response = await POST(request);

      // Fulfillment was re-entered (claim won, registrar attempted) even
      // though the transaction was already completed. The registrar failed
      // definitively, so the delivery fails retryably (503) after releasing
      // the claim — the next redelivery can attempt fulfillment again.
      expect(registerDomain).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(503);
    });

    it('repairs a missing domains row for a fulfilled purchase without contacting the registrar (review #2991 P2 regression test)', async () => {
      // Go54 succeeded but the domains write failed on the original attempt:
      // the webhook retry must recreate the row from transaction metadata and
      // must NEVER re-order at the registrar.
      const body = {
        reference: 'DOM-REGRESSION5',
        status: 'success',
        event: 'charge.success',
        amount: 19499,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 19499,
          reference: 'DOM-REGRESSION5',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      const domainTransaction = {
        id: 'txn-dom-5',
        merchant_id: 'merchant-123',
        amount: '19499',
        currency: 'NGN',
        gateway_reference: 'DOM-REGRESSION5',
        status: 'completed',
        order_id: null,
        metadata: {
          transaction_type: 'domain_purchase',
          domain: 'junglee.com',
          tld: '.com',
          years: 1,
          domain_purchased: 'junglee.com',
          purchased_at: '2026-07-08T00:00:00.000Z',
          domain_registrar_order_id: 'go54-999',
        },
      };

      const domainsInsert = vi.fn().mockReturnThis();

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          const selectChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: domainTransaction,
              error: null,
            }),
          };
          return {
            select: vi.fn(() => selectChain),
            update: vi.fn(() => {
              let statusIdempotencyUpdate = false;
              const chain = {
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn(() => {
                  statusIdempotencyUpdate = true;
                  return chain;
                }),
                is: vi.fn().mockReturnThis(),
                or: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn(() =>
                  Promise.resolve({
                    data: statusIdempotencyUpdate ? null : { id: 'txn-dom-5' },
                    error: null,
                  })
                ),
              };
              return chain;
            }),
          } as never;
        }
        if (table === 'domains') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null, // the row is missing — repair should insert it
              error: null,
            }),
            insert: domainsInsert,
          } as never;
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as never;
      });
      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        const data =
          name === 'claim_payment_side_effect'
            ? { we_won: true, current_status: 'claimed' }
            : null;
        const result = { data, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const { registerDomain } = await import('@/lib/go54');

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(registerDomain).not.toHaveBeenCalled();
      expect(domainsInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: 'junglee.com',
          domain_type: 'purchased',
          go54_order_id: 'go54-999',
          merchant_id: 'merchant-123',
        })
      );
    });

    it('returns 200 without calling registerDomain when an active domain already exists for the merchant', async () => {
      const body = {
        reference: 'DOM-REGRESSION6',
        status: 'success',
        event: 'charge.success',
        amount: 19499,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 19499,
          reference: 'DOM-REGRESSION6',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      const domainTransaction = {
        id: 'txn-dom-6',
        merchant_id: 'merchant-123',
        amount: '19499',
        currency: 'NGN',
        gateway_reference: 'DOM-REGRESSION6',
        status: 'completed',
        order_id: null,
        metadata: {
          transaction_type: 'domain_purchase',
          domain: 'junglee.com',
          tld: '.com',
          years: 1,
        },
      };

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          const selectChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: domainTransaction,
              error: null,
            }),
          };
          return {
            select: vi.fn(() => selectChain),
            update: vi.fn(() => {
              let statusIdempotencyUpdate = false;
              const chain = {
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn(() => {
                  statusIdempotencyUpdate = true;
                  return chain;
                }),
                is: vi.fn().mockReturnThis(),
                or: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn(() =>
                  Promise.resolve({
                    data: statusIdempotencyUpdate ? null : { id: 'txn-dom-6' },
                    error: null,
                  })
                ),
              };
              return chain;
            }),
          } as never;
        }
        if (table === 'merchants') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                business_name: 'Test Store',
                email: 'owner@example.com',
                address: '1 Test Rd',
                city: 'Lagos',
                state: 'Lagos',
                phone: '+2348000000000',
                users: { first_name: 'Test', last_name: 'Owner' },
              },
              error: null,
            }),
          } as never;
        }
        if (table === 'domains') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                domain_type: 'purchased',
                go54_order_id: null,
                id: 'domain-existing',
                merchant_id: 'merchant-123',
                status: 'active',
              },
              error: null,
            }),
          } as never;
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as never;
      });
      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        const data =
          name === 'claim_payment_side_effect'
            ? { we_won: true, current_status: 'claimed' }
            : null;
        const result = { data, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const { registerDomain } = await import('@/lib/go54');

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(registerDomain).not.toHaveBeenCalled();
    });

    it('continues to registrar fulfillment when a pre-existing domain row lacks registrar proof', async () => {
      const body = {
        reference: 'DOM-REGRESSION9',
        status: 'success',
        event: 'charge.success',
        amount: 19499,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 19499,
          reference: 'DOM-REGRESSION9',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      const domainTransaction = {
        id: 'txn-dom-9',
        merchant_id: 'merchant-123',
        amount: '19499',
        currency: 'NGN',
        gateway_reference: 'DOM-REGRESSION9',
        status: 'completed',
        order_id: null,
        metadata: {
          transaction_type: 'domain_purchase',
          domain: 'junglee.com',
          tld: '.com',
          years: 1,
        },
      };
      const domainUpdate = vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
      }));
      const domainInsert = vi.fn();

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          const selectChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: domainTransaction,
              error: null,
            }),
          };
          return {
            select: vi.fn(() => selectChain),
            update: vi.fn(() => {
              let statusIdempotencyUpdate = false;
              const chain = {
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn(() => {
                  statusIdempotencyUpdate = true;
                  return chain;
                }),
                is: vi.fn().mockReturnThis(),
                or: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn(() =>
                  Promise.resolve({
                    data: statusIdempotencyUpdate ? null : { id: 'txn-dom-9' },
                    error: null,
                  })
                ),
              };
              return chain;
            }),
          } as never;
        }
        if (table === 'merchants') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                business_name: 'Test Store',
                email: 'owner@example.com',
                address: '1 Test Rd',
                city: 'Lagos',
                state: 'Lagos',
                phone: '+2348000000000',
                users: { first_name: 'Test', last_name: 'Owner' },
              },
              error: null,
            }),
          } as never;
        }
        if (table === 'domains') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'domain-pending',
                merchant_id: 'merchant-123',
                status: 'pending',
              },
              error: null,
            }),
            update: domainUpdate,
            insert: domainInsert,
          } as never;
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as never;
      });
      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        const data =
          name === 'claim_payment_side_effect'
            ? { we_won: true, current_status: 'claimed' }
            : null;
        const result = { data, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const { registerDomain } = await import('@/lib/go54');
      vi.mocked(registerDomain).mockResolvedValue({
        success: true,
        orderId: 'go54-777',
      } as never);

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(registerDomain).toHaveBeenCalledTimes(1);
      expect(domainUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          go54_order_id: 'go54-777',
          status: 'active',
        })
      );
      expect(domainInsert).not.toHaveBeenCalled();
    });

    it('releases and retries when fulfillment throws before the registrar attempt is stamped', async () => {
      const body = {
        reference: 'DOM-REGRESSION7',
        status: 'success',
        event: 'charge.success',
        amount: 19499,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 19499,
          reference: 'DOM-REGRESSION7',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      const domainTransaction = {
        id: 'txn-dom-7',
        merchant_id: 'merchant-123',
        amount: '19499',
        currency: 'NGN',
        gateway_reference: 'DOM-REGRESSION7',
        status: 'completed',
        order_id: null,
        metadata: {
          transaction_type: 'domain_purchase',
          domain: 'junglee.com',
          tld: '.com',
          years: 1,
        },
      };
      let updateCall = 0;

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          const selectChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: domainTransaction,
              error: null,
            }),
          };
          return {
            select: vi.fn(() => selectChain),
            update: vi.fn(() => {
              updateCall += 1;
              let statusIdempotencyUpdate = false;
              const chain = {
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn(() => {
                  statusIdempotencyUpdate = true;
                  return chain;
                }),
                is: vi.fn().mockReturnThis(),
                or: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn(() => {
                  if (updateCall === 3) {
                    return Promise.reject(new Error('connection reset'));
                  }
                  return Promise.resolve({
                    data: statusIdempotencyUpdate ? null : { id: 'txn-dom-7' },
                    error: null,
                  });
                }),
              };
              return chain;
            }),
          } as never;
        }
        if (table === 'merchants') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                business_name: 'Test Store',
                email: 'owner@example.com',
                address: '1 Test Rd',
                city: 'Lagos',
                state: 'Lagos',
                phone: '+2348000000000',
                users: { first_name: 'Test', last_name: 'Owner' },
              },
              error: null,
            }),
          } as never;
        }
        if (table === 'domains') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          } as never;
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as never;
      });
      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        const data =
          name === 'claim_payment_side_effect'
            ? { we_won: true, current_status: 'claimed' }
            : null;
        const result = { data, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const { registerDomain } = await import('@/lib/go54');

      const response = await POST(request);

      expect(response.status).toBe(500);
      expect(registerDomain).not.toHaveBeenCalled();
      expect(updateCall).toBe(4);
    });

    it('releases the domain fulfillment claim when Go54 throws a definitive registrar rejection', async () => {
      const body = {
        reference: 'DOM-REGRESSION9',
        status: 'success',
        event: 'charge.success',
        amount: 19499,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 19499,
          reference: 'DOM-REGRESSION9',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      const domainTransaction = {
        id: 'txn-dom-9',
        merchant_id: 'merchant-123',
        amount: '19499',
        currency: 'NGN',
        gateway_reference: 'DOM-REGRESSION9',
        status: 'completed',
        order_id: null,
        metadata: {
          transaction_type: 'domain_purchase',
          domain: 'junglee.com',
          tld: '.com',
          years: 1,
        },
      };
      const transactionUpdatePayloads: Record<string, unknown>[] = [];

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          const selectChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: domainTransaction,
              error: null,
            }),
          };
          return {
            select: vi.fn(() => selectChain),
            update: vi.fn((payload: Record<string, unknown>) => {
              transactionUpdatePayloads.push(payload);
              let statusIdempotencyUpdate = false;
              const chain = {
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn(() => {
                  statusIdempotencyUpdate = true;
                  return chain;
                }),
                is: vi.fn().mockReturnThis(),
                or: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn(() =>
                  Promise.resolve({
                    data: statusIdempotencyUpdate ? null : { id: 'txn-dom-9' },
                    error: null,
                  })
                ),
              };
              return chain;
            }),
          } as never;
        }
        if (table === 'merchants') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                business_name: 'Test Store',
                email: 'owner@example.com',
                address: '1 Test Rd',
                city: 'Lagos',
                state: 'Lagos',
                phone: '+2348000000000',
                users: { first_name: 'Test', last_name: 'Owner' },
              },
              error: null,
            }),
          } as never;
        }
        if (table === 'domains') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          } as never;
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as never;
      });
      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        const data =
          name === 'claim_payment_side_effect'
            ? { we_won: true, current_status: 'claimed' }
            : null;
        const result = { data, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const { registerDomain } = await import('@/lib/go54');
      vi.mocked(registerDomain).mockRejectedValue(
        new Error('Go54 API Error: {"message":"insufficient balance"}')
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(registerDomain).toHaveBeenCalledTimes(1);
      expect(
        transactionUpdatePayloads.some((payload) => {
          const metadata = payload.metadata as
            | Record<string, unknown>
            | undefined;
          return Boolean(metadata?.fulfillment_registrar_attempted_at);
        })
      ).toBe(true);
      expect(
        transactionUpdatePayloads.some((payload) => {
          const metadata = payload.metadata as
            | Record<string, unknown>
            | undefined;
          return (
            metadata?.transaction_type === 'domain_purchase' &&
            !('fulfillment_claimed_by' in metadata) &&
            !('fulfillment_registrar_attempted_at' in metadata) &&
            !('domain_purchased' in metadata)
          );
        })
      ).toBe(true);
    });

    it('keeps failing retryably when an attempted domain fulfillment claim is still contested', async () => {
      const body = {
        reference: 'DOM-REGRESSION10',
        status: 'success',
        event: 'charge.success',
        amount: 19499,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 19499,
          reference: 'DOM-REGRESSION10',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      const domainTransaction = {
        id: 'txn-dom-10',
        merchant_id: 'merchant-123',
        amount: '19499',
        currency: 'NGN',
        gateway_reference: 'DOM-REGRESSION10',
        status: 'completed',
        order_id: null,
        metadata: {
          transaction_type: 'domain_purchase',
          domain: 'junglee.com',
          tld: '.com',
          years: 1,
          fulfillment_claimed_by: 'webhook',
          fulfillment_claimed_at: '2026-07-08T00:00:00.000Z',
          fulfillment_registrar_attempted_at: '2026-07-08T00:00:01.000Z',
        },
      };

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          const selectChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: domainTransaction,
              error: null,
            }),
          };
          return {
            select: vi.fn(() => selectChain),
            update: vi.fn(() => {
              const chain = {
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn().mockReturnThis(),
                is: vi.fn().mockReturnThis(),
                or: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn(() =>
                  Promise.resolve({
                    data: null,
                    error: null,
                  })
                ),
              };
              return chain;
            }),
          } as never;
        }
        if (table === 'merchants') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                business_name: 'Test Store',
                email: 'owner@example.com',
                address: '1 Test Rd',
                city: 'Lagos',
                state: 'Lagos',
                phone: '+2348000000000',
                users: { first_name: 'Test', last_name: 'Owner' },
              },
              error: null,
            }),
          } as never;
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as never;
      });
      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        const data =
          name === 'claim_payment_side_effect'
            ? { we_won: true, current_status: 'claimed' }
            : null;
        const result = { data, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const { registerDomain } = await import('@/lib/go54');

      const response = await POST(request);
      const json = await response.json();

      expect(response.status).toBe(503);
      expect(json.error).toBe(
        'Domain fulfillment requires manual reconciliation before retry'
      );
      expect(registerDomain).not.toHaveBeenCalled();
    });

    it('fails retryably when post-registration domain lookup fails', async () => {
      const body = {
        reference: 'DOM-REGRESSION8',
        status: 'success',
        event: 'charge.success',
        amount: 19499,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 19499,
          reference: 'DOM-REGRESSION8',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      const domainTransaction = {
        id: 'txn-dom-8',
        merchant_id: 'merchant-123',
        amount: '19499',
        currency: 'NGN',
        gateway_reference: 'DOM-REGRESSION8',
        status: 'completed',
        order_id: null,
        metadata: {
          transaction_type: 'domain_purchase',
          domain: 'junglee.com',
          tld: '.com',
          years: 1,
        },
      };
      let domainsLookupCall = 0;

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          const selectChain = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: domainTransaction,
              error: null,
            }),
          };
          return {
            select: vi.fn(() => selectChain),
            update: vi.fn(() => {
              let statusIdempotencyUpdate = false;
              const chain = {
                eq: vi.fn().mockReturnThis(),
                neq: vi.fn(() => {
                  statusIdempotencyUpdate = true;
                  return chain;
                }),
                is: vi.fn().mockReturnThis(),
                or: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn(() =>
                  Promise.resolve({
                    data: statusIdempotencyUpdate ? null : { id: 'txn-dom-8' },
                    error: null,
                  })
                ),
              };
              return chain;
            }),
          } as never;
        }
        if (table === 'merchants') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                business_name: 'Test Store',
                email: 'owner@example.com',
                address: '1 Test Rd',
                city: 'Lagos',
                state: 'Lagos',
                phone: '+2348000000000',
                users: { first_name: 'Test', last_name: 'Owner' },
              },
              error: null,
            }),
          } as never;
        }
        if (table === 'domains') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(() => {
              domainsLookupCall += 1;
              if (domainsLookupCall === 2) {
                return Promise.resolve({
                  data: null,
                  error: { message: 'lookup failed' },
                });
              }
              return Promise.resolve({
                data: null,
                error: null,
              });
            }),
          } as never;
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as never;
      });
      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        const data =
          name === 'claim_payment_side_effect'
            ? { we_won: true, current_status: 'claimed' }
            : null;
        const result = { data, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const { registerDomain } = await import('@/lib/go54');
      vi.mocked(registerDomain).mockResolvedValue({
        success: true,
        orderId: 'go54-888',
      } as never);

      const response = await POST(request);

      expect(response.status).toBe(503);
      expect(registerDomain).toHaveBeenCalledTimes(1);
    });
  });

  describe('Reference Validation', () => {
    it('returns 400 when reference is invalid', async () => {
      const body = {
        reference: '',
        status: 'success',
        event: 'charge.success',
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');

      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Invalid reference' });
    });

    it('acknowledges a signed Paystack success webhook with an invalid reference without retrying', async () => {
      const body = {
        event: 'charge.success',
        data: {
          reference: '',
        },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');

      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { logger } = await import('@/lib/logger');
      const { verifyTransaction } = await import('@/lib/paystack');

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ message: 'Paystack webhook accepted for review' });
      expect(verifyTransaction).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          gateway: 'paystack',
          message: 'Paystack webhook has invalid reference',
        })
      );
    });
  });

  describe('Payment Verification', () => {
    it('returns 400 when payment verification fails', async () => {
      const body = {
        reference: 'REF123',
        status: 'success',
        event: 'charge.success',
        amount: 1000,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');

      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      // Mock payment verification failure
      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: false,
        error: 'Payment verification failed',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Payment verification failed' });
    });

    it('asks Paystack to retry when verification fails transiently', async () => {
      const body = {
        event: 'charge.success',
        data: { reference: 'REF123' },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');

      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { logger } = await import('@/lib/logger');
      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: false,
        error: 'Network error',
        code: 'NETWORK_ERROR',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data).toEqual({
        error: 'Paystack verification temporarily unavailable',
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          gateway: 'paystack',
          message: 'Paystack webhook verification failed transiently',
          reference: 'REF123',
        })
      );
    });

    it('acknowledges non-retryable Paystack verification failures after logging for review', async () => {
      const body = {
        event: 'charge.success',
        data: { reference: 'REF123' },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');

      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { logger } = await import('@/lib/logger');
      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: false,
        error: 'Transaction reference not found',
        code: 'HTTP_404',
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ message: 'Paystack webhook accepted for review' });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          gateway: 'paystack',
          message:
            'Paystack webhook verification failed with non-retryable result',
          reference: 'REF123',
        })
      );
    });

    it('acknowledges a Paystack charge.success event when verification returns a non-success status', async () => {
      const body = {
        event: 'charge.success',
        data: { reference: 'REF123' },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');

      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { logger } = await import('@/lib/logger');
      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          id: 1,
          status: 'failed',
          amount: 100000,
          reference: 'REF123',
          currency: 'NGN',
          channel: 'card',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: {
            id: 1,
            email: 'test@example.com',
            customer_code: 'CUS_test',
            first_name: null,
            last_name: null,
            phone: null,
          },
          metadata: null,
          fees: 150,
          fees_split: null,
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ message: 'Paystack webhook accepted for review' });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          gateway: 'paystack',
          message: 'Paystack webhook verification returned non-success status',
          reference: 'REF123',
          status: 'failed',
        })
      );
    });

    it('returns 400 when payment status is not success', async () => {
      const body = {
        reference: 'REF123',
        status: 'success',
        event: 'charge.success',
        amount: 1000,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');

      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      // Mock payment verification returns failed status
      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'failed',
          amount: 1000,
          reference: 'REF123',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Payment not successful' });
    });
  });

  describe('Transaction Lookup', () => {
    it('returns 404 when transaction is not found', async () => {
      const body = {
        reference: 'REF123',
        status: 'success',
        event: 'charge.success',
        amount: 1000,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');

      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 1000,
          reference: 'REF123',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      // Mock transaction not found - setup from() to return a chain that fails
      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null,
              error: {
                message: 'Not found',
                code: 'PGRST116',
                details: 'The result contains 0 rows',
              },
            }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({ error: 'Transaction not found' });
    });

    async function preparePaystackZeroCandidateRequest({
      reviewError = null,
      transactionError = {
        code: 'PGRST116',
        message: 'Not found',
        details: 'The result contains 0 rows',
      },
    }: {
      reviewError?: null | { code?: string; message: string };
      transactionError?: {
        code?: string;
        details?: string;
        message: string;
      };
    } = {}) {
      const reference = '09FG260626140359226K1RHXD';
      const body = {
        event: 'charge.success',
        data: {
          amount: 100000,
          reference,
        },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');
      const reviewInsert = vi
        .fn()
        .mockResolvedValue({ data: null, error: reviewError });

      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { logger } = await import('@/lib/logger');
      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          id: 1,
          status: 'success',
          amount: 100000,
          reference,
          currency: 'NGN',
          channel: 'bank_transfer',
          paid_at: '2026-06-27T20:37:08.000Z',
          created_at: '2026-06-27T20:36:00.000Z',
          customer: {
            id: 1,
            email: 'customer@example.com',
            customer_code: 'CUS_test',
            first_name: null,
            last_name: null,
            phone: null,
          },
          metadata: null,
          fees: 150,
          fees_split: null,
        },
      });

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null,
              error: transactionError,
            }),
          } as any;
        }
        if (table === 'reconciliation_review') {
          return { insert: reviewInsert } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      return { logger, reference, request, reviewInsert };
    }

    it('does not acknowledge Paystack payments when local transaction lookup fails', async () => {
      const body = {
        event: 'charge.success',
        data: {
          amount: 100000,
          reference: '09FG260626140359226K1RHXD',
        },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');
      const reviewInsert = vi
        .fn()
        .mockResolvedValue({ data: null, error: null });

      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { logger } = await import('@/lib/logger');
      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          id: 1,
          status: 'success',
          amount: 100000,
          reference: '09FG260626140359226K1RHXD',
          currency: 'NGN',
          channel: 'bank_transfer',
          paid_at: '2026-06-27T20:37:08.000Z',
          created_at: '2026-06-27T20:36:00.000Z',
          customer: {
            id: 1,
            email: 'customer@example.com',
            customer_code: 'CUS_test',
            first_name: null,
            last_name: null,
            phone: null,
          },
          metadata: null,
          fees: 150,
          fees_split: null,
        },
      });

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null,
              error: {
                code: '57014',
                message: 'canceling statement due to statement timeout',
              },
            }),
          } as any;
        }
        if (table === 'reconciliation_review') {
          return { insert: reviewInsert } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({ error: 'Transaction lookup failed' });
      expect(reviewInsert).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Transaction lookup failed',
          reference: '09FG260626140359226K1RHXD',
        })
      );
    });

    it('does not acknowledge Paystack payments when singular transaction lookup finds duplicate rows', async () => {
      const { logger, request, reviewInsert } =
        await preparePaystackZeroCandidateRequest({
          transactionError: {
            code: 'PGRST116',
            details: 'The result contains 2 rows',
            message: 'JSON object requested, multiple (or no) rows returned',
          },
        });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({ error: 'Transaction lookup failed' });
      expect(reviewInsert).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Transaction lookup failed',
          reference: '09FG260626140359226K1RHXD',
        })
      );
    });

    it('does not acknowledge Paystack payments when DVA order-account matching fails transiently', async () => {
      const reference = '09FG260626140359226K1RHXD';
      const body = {
        event: 'charge.success',
        data: {
          amount: 100000,
          reference,
        },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');
      const reviewInsert = vi
        .fn()
        .mockResolvedValue({ data: null, error: null });
      const transactionLookup = vi.fn();

      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { logger } = await import('@/lib/logger');
      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          id: 1,
          status: 'success',
          amount: 100000,
          reference,
          currency: 'NGN',
          channel: 'bank_transfer',
          paid_at: '2026-06-27T20:37:08.000Z',
          created_at: '2026-06-27T20:36:00.000Z',
          customer: {
            id: 1,
            email: 'customer@example.com',
            customer_code: 'CUS_test',
            first_name: null,
            last_name: null,
            phone: null,
          },
          metadata: null,
          fees: 150,
          fees_split: null,
        },
      });
      mockGetPaystackDvaReceiverAccountNumber.mockReturnValue('9812858131');

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'order_payment_accounts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: null,
                error: {
                  code: '57014',
                  message: 'canceling statement due to statement timeout',
                },
              }),
            }),
          } as any;
        }
        if (table === 'transactions') {
          transactionLookup(table);
        }
        if (table === 'reconciliation_review') {
          return { insert: reviewInsert } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Paystack DVA matching temporarily unavailable',
      });
      expect(reviewInsert).not.toHaveBeenCalled();
      expect(transactionLookup).not.toHaveBeenCalled();
      expect(mockConfirmPaystackWalletDvaTopUp).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'B1 order_payment_accounts lookup failed',
        })
      );
    });

    it('acknowledges verified Paystack payments with zero local candidates after filing review', async () => {
      const body = {
        event: 'charge.success',
        data: {
          amount: 100000,
          reference: '09FG260626140359226K1RHXD',
        },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');
      const reviewInsert = vi
        .fn()
        .mockResolvedValue({ data: null, error: null });

      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { logger } = await import('@/lib/logger');
      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          id: 1,
          status: 'success',
          amount: 100000,
          reference: '09FG260626140359226K1RHXD',
          currency: 'NGN',
          channel: 'bank_transfer',
          paid_at: '2026-06-27T20:37:08.000Z',
          created_at: '2026-06-27T20:36:00.000Z',
          customer: {
            id: 1,
            email: 'customer@example.com',
            customer_code: 'CUS_test',
            first_name: null,
            last_name: null,
            phone: null,
          },
          metadata: null,
          fees: 150,
          fees_split: null,
        },
      });

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null,
              error: {
                code: 'PGRST116',
                message: 'Not found',
                details: 'The result contains 0 rows',
              },
            }),
          } as any;
        }
        if (table === 'reconciliation_review') {
          return { insert: reviewInsert } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const response = await POST(request);
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data).toEqual({
        code: 'PAYSTACK_PAYMENT_MATCH_ZERO_CANDIDATES',
        message: 'Paystack webhook accepted for reconciliation review',
      });
      expect(reviewInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          candidates: [],
          issue_type: 'payment_match_zero_candidates',
          paystack_ref: '09FG260626140359226K1RHXD',
          metadata: expect.objectContaining({
            channel: 'bank_transfer',
            currency: 'NGN',
            customer_email: 'customer@example.com',
            verified_amount: 1000,
          }),
        })
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          duplicateReview: false,
          message:
            'Paystack webhook acknowledged with zero local payment candidates',
          reference: '09FG260626140359226K1RHXD',
        })
      );
      expect(logger.error).not.toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Transaction not found' })
      );
    });

    it('acknowledges duplicate Paystack zero-candidate review inserts as webhook retry no-ops', async () => {
      const { logger, reference, request, reviewInsert } =
        await preparePaystackZeroCandidateRequest({
          reviewError: {
            code: '23505',
            message:
              'duplicate key value violates unique constraint "reconciliation_review_open_by_paystack_ref_idx"',
          },
        });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        code: 'PAYSTACK_PAYMENT_MATCH_ZERO_CANDIDATES',
        message: 'Paystack webhook accepted for reconciliation review',
      });
      expect(reviewInsert).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Paystack zero-candidate payment review already filed (expected webhook retry no-op)',
          reference,
        })
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          duplicateReview: true,
          message:
            'Paystack webhook acknowledged with zero local payment candidates',
          reference,
        })
      );
    });

    it('returns 500 when Paystack zero-candidate review filing fails', async () => {
      const { logger, reference, request, reviewInsert } =
        await preparePaystackZeroCandidateRequest({
          reviewError: {
            code: 'XX000',
            message: 'internal database error',
          },
        });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        error: 'Payment reconciliation review unavailable',
      });
      expect(reviewInsert).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Failed to file Paystack zero-candidate payment review',
          reference,
        })
      );
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Paystack webhook acknowledged with zero local payment candidates',
        })
      );
    });
  });

  describe('Amount Validation', () => {
    it('returns 400 when payment amount does not match transaction amount', async () => {
      const body = {
        reference: 'REF123',
        status: 'success',
        event: 'charge.success',
        amount: 2000, // Different from transaction
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');

      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 2000,
          reference: 'REF123',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      // Setup transaction with different amount
      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'txn-123',
                merchant_id: 'merchant-123',
                amount: '1000', // Expected amount
                currency: 'NGN',
                gateway_reference: 'REF123',
                status: 'pending',
              },
              error: null,
            }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Payment amount mismatch' });
    });
  });

  describe('Idempotency', () => {
    it('acknowledges already-processed payments when agentic reconciliation fails', async () => {
      const body = {
        event: 'charge.success',
        data: { reference: 'REF123' },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');

      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { logger } = await import('@/lib/logger');
      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          id: 1,
          status: 'success',
          amount: 100000,
          reference: 'REF123',
          currency: 'NGN',
          channel: 'bank_transfer',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: {
            customer_code: 'CUS_test',
            email: 'test@example.com',
            first_name: 'Test',
            id: 1,
            last_name: null,
            phone: null,
          },
          metadata: null,
          fees: 0,
          fees_split: null,
        },
      });
      mockMarkAgenticPaystackDvaSessionPaid.mockResolvedValueOnce({
        error: 'session update failed',
        ok: false,
      });

      // Mock transaction lookup and update for already-processed scenario
      let callCount = 0;
      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          callCount++;
          if (callCount === 1) {
            // First call: transaction lookup
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'txn-123',
                  merchant_id: 'merchant-123',
                  order_id: 'order-123',
                  amount: '1000',
                  currency: 'NGN',
                  gateway_reference: 'BAC-REF123',
                  metadata: {
                    transaction_type: 'agentic_checkout_payment',
                  },
                  status: 'completed', // Already completed
                },
                error: null,
              }),
            } as any;
          }
          // Second call: transaction update
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null, // Update returns null (transaction already completed)
              error: null,
            }),
          } as any;
        }
        // The short-circuit path now re-reads order state (not cancelled/
        // refunded here) then, via finalizeOrderGatewayPayment, re-fetches the
        // rich order row. Both calls land on this same chain: state lookup
        // uses .maybeSingle(), the rich fetch uses .single().
        if (table === 'orders') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'order-123',
                payment_status: 'paid',
                shipping_status: 'processing',
                cancelled_at: null,
              },
              error: null,
            }),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'order-123',
                order_number: 'ORD-123',
                merchant_id: 'merchant-123',
                customer_name: 'Test Customer',
                customer_email: 'test@example.com',
                customer_phone: null,
                total: '1000',
                subtotal: '1000',
                shipping_fee: '0',
                currency: 'NGN',
                shipping_address: {},
                order_items: [],
              },
              error: null,
            }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          limit: vi.fn().mockResolvedValue({
            data: [{ order_id: 'order-123', transaction_id: 'txn-123' }],
            error: null,
          }),
        } as any;
      });
      // This is a genuine replay of an already fully-processed payment: the
      // atomic RPC reports the order was already paid and nothing to update.
      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        const data =
          name === 'complete_order_gateway_payment'
            ? {
                actor: null,
                already_completed: true,
                order_already_paid: true,
                order_updated: false,
                order_cancelled: false,
                order_skipped_status: null,
                previous_payment_status: 'paid',
                previous_shipping_status: 'processing',
                payment_status: 'paid',
                shipping_status: 'processing',
                cancelled_at: null,
                order_number: 'ORD-123',
              }
            : null;
        const result = { data, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toMatchObject({
        error: 'Agentic checkout session reconciliation failed',
      });
      expect(mockMarkAgenticPaystackDvaSessionPaid).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Agentic checkout session reconciliation failed',
          reference: 'REF123',
        })
      );
    });

    it('acknowledges already-processed payments when agentic reconciliation succeeds', async () => {
      const body = {
        event: 'charge.success',
        data: { reference: 'REF123' },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');
      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { logger } = await import('@/lib/logger');
      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          id: 1,
          status: 'success',
          amount: 100000,
          reference: 'REF123',
          currency: 'NGN',
          channel: 'bank_transfer',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: {
            customer_code: 'CUS_test',
            email: 'test@example.com',
            first_name: 'Test',
            id: 1,
            last_name: null,
            phone: null,
          },
          metadata: null,
          fees: 0,
          fees_split: null,
        },
      });
      mockMarkAgenticPaystackDvaSessionPaid.mockResolvedValueOnce({
        ok: true,
      });

      let callCount = 0;
      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          callCount++;
          if (callCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'txn-123',
                  merchant_id: 'merchant-123',
                  order_id: 'order-123',
                  amount: '1000',
                  currency: 'NGN',
                  gateway_reference: 'BAC-REF123',
                  metadata: {
                    transaction_type: 'agentic_checkout_payment',
                  },
                  status: 'completed',
                },
                error: null,
              }),
            } as any;
          }
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          } as any;
        }
        // The short-circuit path now re-reads order state (not cancelled/
        // refunded here) then, via finalizeOrderGatewayPayment, re-fetches the
        // rich order row. Both calls land on this same chain: state lookup
        // uses .maybeSingle(), the rich fetch uses .single().
        if (table === 'orders') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'order-123',
                payment_status: 'paid',
                shipping_status: 'processing',
                cancelled_at: null,
              },
              error: null,
            }),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'order-123',
                order_number: 'ORD-123',
                merchant_id: 'merchant-123',
                customer_name: 'Test Customer',
                customer_email: 'test@example.com',
                customer_phone: null,
                total: '1000',
                subtotal: '1000',
                shipping_fee: '0',
                currency: 'NGN',
                shipping_address: {},
                order_items: [],
              },
              error: null,
            }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          limit: vi.fn().mockResolvedValue({
            data: [{ order_id: 'order-123', transaction_id: 'txn-123' }],
            error: null,
          }),
        } as any;
      });
      // This is a genuine replay of an already fully-processed payment: the
      // atomic RPC reports the order was already paid and nothing to update.
      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        const data =
          name === 'complete_order_gateway_payment'
            ? {
                actor: null,
                already_completed: true,
                order_already_paid: true,
                order_updated: false,
                order_cancelled: false,
                order_skipped_status: null,
                previous_payment_status: 'paid',
                previous_shipping_status: 'processing',
                payment_status: 'paid',
                shipping_status: 'processing',
                cancelled_at: null,
                order_number: 'ORD-123',
              }
            : null;
        const result = { data, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ message: 'Already processed' });
      expect(mockMarkAgenticPaystackDvaSessionPaid).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Transaction already processed',
          reference: 'REF123',
        })
      );
    });

    it('heals a wedged order on webhook redelivery (July 2026 ORD-260711-00NT-5 incident regression)', async () => {
      // Arrange: the transaction is already completed (a prior delivery won
      // the flip) but the order is STILL pending — the crashed-order-update
      // wedge. The redelivery must flip the order and run side effects
      // instead of returning a bare "Already processed" no-op.
      const body = {
        event: 'charge.success',
        data: { reference: 'REF123' },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');
      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { logger } = await import('@/lib/logger');
      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          id: 1,
          status: 'success',
          amount: 100000,
          reference: 'REF123',
          currency: 'NGN',
          channel: 'dedicated_nuban',
          paid_at: '2026-07-11T17:25:08Z',
          created_at: '2026-07-11T17:25:08Z',
          customer: {
            customer_code: 'CUS_test',
            email: 'danneey7@example.com',
            first_name: 'Daniel',
            id: 1,
            last_name: null,
            phone: null,
          },
          metadata: null,
          fees: 30000,
          fees_split: null,
        },
      });

      let transactionCallCount = 0;
      const orderStateLookup = vi.fn().mockResolvedValue({
        data: {
          id: 'order-123',
          payment_status: 'pending',
          shipping_status: 'pending',
          cancelled_at: null,
        },
        error: null,
      });
      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          transactionCallCount++;
          if (transactionCallCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'txn-123',
                  merchant_id: 'merchant-123',
                  order_id: 'order-123',
                  amount: '1000',
                  currency: 'NGN',
                  gateway_reference: 'REF123',
                  metadata: { customer_email: 'danneey7@example.com' },
                  status: 'completed',
                },
                error: null,
              }),
            } as any;
          }
          // The atomic flip attempt loses: the transaction is already
          // completed, so .maybeSingle() returns no row.
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          } as any;
        }
        if (table === 'orders') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: orderStateLookup,
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'order-123',
                order_number: 'ORD-260711-00NT-5',
                merchant_id: 'merchant-123',
                customer_name: 'Daniel Agboli',
                customer_email: 'danneey7@example.com',
                customer_phone: null,
                total: '1000',
                subtotal: '1000',
                shipping_fee: '0',
                currency: 'NGN',
                shipping_address: {},
                order_items: [],
              },
              error: null,
            }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          limit: vi.fn().mockResolvedValue({
            data: [{ order_id: 'order-123', transaction_id: 'txn-123' }],
            error: null,
          }),
        } as any;
      });
      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        const data =
          name === 'complete_order_gateway_payment'
            ? {
                actor: null,
                already_completed: true,
                order_already_paid: false,
                order_updated: true,
                order_cancelled: false,
                order_skipped_status: null,
                previous_payment_status: 'pending',
                previous_shipping_status: 'pending',
                payment_status: 'paid',
                shipping_status: 'processing',
                cancelled_at: null,
                order_number: 'ORD-260711-00NT-5',
              }
            : name === 'claim_payment_side_effect'
              ? { we_won: true, current_status: 'claimed' }
              : null;
        const result = { data, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as any;
      });

      // Act
      const response = await POST(request);
      const data = await response.json();

      // Assert: the redelivery healed the order via the atomic RPC and
      // reported success to the gateway.
      expect(response.status).toBe(200);
      expect(data).toEqual({ message: 'Already processed' });
      expect(mockServiceClient.rpc).toHaveBeenCalledWith(
        'complete_order_gateway_payment',
        expect.objectContaining({
          p_order_id: 'order-123',
          p_transaction_id: 'txn-123',
        })
      );
      expect(mockRunPaidOrderSideEffects).toHaveBeenCalledWith(
        expect.objectContaining({
          externalGatewayReference: 'REF123',
          settlementGateway: 'paystack',
        })
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Webhook redelivery healed a wedged order payment',
          orderId: 'order-123',
        })
      );
    });

    it('processes an agentic DVA transaction resolved during preflight when the generic lookup misses', async () => {
      const body = {
        event: 'charge.success',
        data: {
          authorization: {
            receiver_bank_account_number: '9812858131',
          },
          reference: 'REF123',
        },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');
      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          id: 1,
          status: 'success',
          amount: 10000,
          reference: 'REF123',
          currency: 'NGN',
          channel: 'dedicated_nuban',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: {
            customer_code: 'CUS_test',
            email: 'test@example.com',
            first_name: 'Test',
            id: 1,
            last_name: null,
            phone: null,
          },
          metadata: null,
          fees: 0,
          fees_split: null,
        },
      });
      mockGetPaystackDvaReceiverAccountNumber.mockReturnValue('9812858131');
      mockConfirmAgenticPaystackDvaPayment.mockResolvedValueOnce({
        handled: false,
        transaction: {
          amount: 100,
          currency: 'NGN',
          gateway_reference: 'BAC-TEST123',
          id: 'txn-123',
          merchant_id: 'merchant-123',
          metadata: {
            agentic_checkout_session_id: 'agentic_session_1',
            agentic_virtual_account_number: '9812858131',
            transaction_type: 'agentic_checkout_payment',
          },
          order_id: 'order-123',
          platform_fee: 2,
        },
      });
      mockMarkAgenticPaystackDvaSessionPaid.mockResolvedValueOnce({
        ok: true,
      });

      const transactionSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: {
            code: 'PGRST116',
            message: 'Not found',
            details: 'The result contains 0 rows',
          },
        }),
      });
      const transactionUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'txn-123' },
          error: null,
        }),
        neq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
      });
      // The atomic RPC does the flip now; the webhook only re-reads the
      // order via a plain select (no more `.from('orders').update()`).
      const orderSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            ad_tracking: {},
            currency: 'NGN',
            customer_email: 'buyer@example.com',
            customer_id: 'customer-123',
            customer_name: 'Smoke Buyer',
            customer_phone: '08000000000',
            id: 'order-123',
            merchant_id: 'merchant-123',
            order_items: [],
            order_number: 'ORD-123',
            payment_status: 'paid',
            shipping_address: {},
            shipping_fee: '0',
            shipping_status: 'processing',
            subtotal: '100',
            total: '100',
            updated_at: '2026-01-01T00:00:00Z',
          },
          error: null,
        }),
      });

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          return {
            select: transactionSelect,
            update: transactionUpdate,
          } as any;
        }
        if (table === 'orders') {
          return { select: orderSelect } as any;
        }
        if (table === 'merchants') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  business_name: 'Baci Smoke',
                  cac_rc_number: null,
                  email: 'merchant@example.com',
                  email_sender_name: 'Baci Smoke',
                  slug: 'ogabassey',
                  support_email: 'support@example.com',
                  tax_identification_number: null,
                },
                error: null,
              }),
            }),
          } as any;
        }
        // A1 payment_side_effects + any other unmocked table:
        // chainable + thenable so the outbox helper's
        // `.update(...).eq().eq().eq().select('order_id')` resolves to an
        // empty array (helper records concurrent_takeover but doesn't crash).
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          neq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock so the A1 outbox helper's `await supabase.from(...).update(...).eq(...).select('order_id')` chain resolves.
          then: (onFulfilled: any) =>
            Promise.resolve({ data: [], error: null }).then(onFulfilled),
        };
        return chain;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        message: 'Payment processed successfully',
        success: true,
      });
      expect(mockGetPaystackDvaReceiverAccountNumber).toHaveBeenCalledWith(
        body
      );
      expect(mockConfirmAgenticPaystackDvaPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          accountNumber: '9812858131',
          gatewayReference: 'REF123',
          verifiedAmount: { amount: 100, currency: 'NGN' },
        })
      );
      expect(transactionSelect).not.toHaveBeenCalled();
      expect(transactionUpdate).toHaveBeenCalled();
      expect(orderSelect).toHaveBeenCalled();
      expect(mockMarkAgenticPaystackDvaSessionPaid).toHaveBeenCalledWith(
        expect.objectContaining({
          gatewayReference: 'REF123',
          transaction: expect.objectContaining({
            order_id: 'order-123',
          }),
        })
      );
    });

    it('credits a wallet DVA transfer after order DVA matching falls through', async () => {
      const body = {
        event: 'charge.success',
        data: {
          authorization: {
            receiver_bank_account_number: '9812858131',
          },
          reference: 'REF123',
        },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');
      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          id: 1,
          status: 'success',
          amount: 2_000_000,
          reference: 'REF123',
          currency: 'NGN',
          channel: 'dedicated_nuban',
          paid_at: '2026-05-21T10:00:00Z',
          created_at: '2026-05-21T09:59:00Z',
          customer: {
            customer_code: 'CUS_test',
            email: 'wallet@example.com',
            first_name: 'Wallet',
            id: 1,
            last_name: null,
            phone: '+2348012345678',
          },
          metadata: null,
          fees: 30000,
          fees_split: null,
        },
      });
      mockGetPaystackDvaReceiverAccountNumber.mockReturnValue('9812858131');
      mockConfirmPaystackWalletDvaTopUp.mockResolvedValueOnce({
        kind: 'match',
        transaction: {
          amount: 20000,
          currency: 'NGN',
          gateway_reference: 'REF123',
          id: 'wallet-txn-1',
          merchant_id: 'merchant-1',
          metadata: {
            customer_id: 'customer-1',
            transaction_type: 'wallet_topup',
          },
          order_id: null,
          platform_fee: 0,
        },
      });

      const transactionUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'wallet-txn-1' },
          error: null,
        }),
        neq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
      });
      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          return {
            select: vi.fn().mockReturnThis(),
            update: transactionUpdate,
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null,
              error: {
                code: 'PGRST116',
                message: 'Not found',
                details: 'The result contains 0 rows',
              },
            }),
          } as any;
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        message: 'Wallet top-up credited',
        reference: 'REF123',
        wallet: { balance: 20000 },
      });
      expect(mockConfirmPaystackWalletDvaTopUp).toHaveBeenCalledWith(
        expect.objectContaining({
          accountNumber: '9812858131',
          gatewayReference: 'REF123',
          verifiedAmount: { amount: 20000, currency: 'NGN' },
        })
      );
      expect(mockCreditWalletTopUp).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 20000,
          customerId: 'customer-1',
          gateway: 'paystack',
          merchantId: 'merchant-1',
          reference: 'REF123',
          transactionId: 'wallet-txn-1',
        })
      );
    });

    // Shared arrange for the wallet-credited push tests: a Paystack DVA transfer
    // that falls through order matching into plain wallet top-up crediting.
    async function buildWalletTopUpWebhookRequest(
      metadata: Record<string, unknown> = {
        customer_id: 'customer-1',
        transaction_type: 'wallet_topup',
      }
    ) {
      const body = {
        event: 'charge.success',
        data: {
          authorization: { receiver_bank_account_number: '9812858131' },
          reference: 'REF123',
        },
      };
      const signature = createSignature(
        JSON.stringify(body),
        'test-paystack-secret'
      );
      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          amount: 2_000_000,
          channel: 'dedicated_nuban',
          created_at: '2026-05-21T09:59:00Z',
          currency: 'NGN',
          customer: {
            customer_code: 'CUS_test',
            email: 'wallet@example.com',
            first_name: 'Wallet',
            id: 1,
            last_name: null,
            phone: '+2348012345678',
          },
          fees: 30000,
          fees_split: null,
          id: 1,
          metadata: null,
          paid_at: '2026-05-21T10:00:00Z',
          reference: 'REF123',
          status: 'success',
        },
      });
      mockGetPaystackDvaReceiverAccountNumber.mockReturnValue('9812858131');
      mockConfirmPaystackWalletDvaTopUp.mockResolvedValueOnce({
        kind: 'match',
        transaction: {
          amount: 20000,
          currency: 'NGN',
          gateway_reference: 'REF123',
          id: 'wallet-txn-1',
          merchant_id: 'merchant-1',
          metadata,
          order_id: null,
          platform_fee: 0,
        },
      });

      const transactionUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'wallet-txn-1' },
          error: null,
        }),
        neq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
      });
      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          return asMockedQueryChain({
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null,
              error: {
                code: 'PGRST116',
                details: 'The result contains 0 rows',
                message: 'Not found',
              },
            }),
            update: transactionUpdate,
          });
        }
        return asMockedQueryChain({
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        });
      });

      return request;
    }

    it('schedules a wallet-credited push on the first credit', async () => {
      const request = await buildWalletTopUpWebhookRequest({
        customer_id: 'customer-1',
        return_to: '/checkout',
        transaction_type: 'wallet_topup',
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockNotifyWalletCredited).toHaveBeenCalledWith({
        amount: 20000,
        customerId: 'customer-1',
        merchantId: 'merchant-1',
        returnTo: '/checkout',
      });
    });

    it('forwards a camelCase returnTo from metadata to the scheduled push', async () => {
      const request = await buildWalletTopUpWebhookRequest({
        customer_id: 'customer-1',
        returnTo: '/utilities/airtime',
        transaction_type: 'wallet_topup',
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockNotifyWalletCredited).toHaveBeenCalledWith({
        amount: 20000,
        customerId: 'customer-1',
        merchantId: 'merchant-1',
        returnTo: '/utilities/airtime',
      });
    });

    it('passes undefined returnTo when metadata carries no return destination', async () => {
      const request = await buildWalletTopUpWebhookRequest({
        customer_id: 'customer-1',
        transaction_type: 'wallet_topup',
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockNotifyWalletCredited).toHaveBeenCalledWith({
        amount: 20000,
        customerId: 'customer-1',
        merchantId: 'merchant-1',
        returnTo: undefined,
      });
    });

    it.each([
      ['auth redirector chain', '/auth/callback?returnTo=//evil.com'],
      ['nested redirect param', '/checkout?redirect=//evil.com'],
      ['protocol-relative', '//evil.com'],
      ['non-resumable route', '/settings'],
    ])('drops a hostile metadata returnTo (%s) before it reaches the push payload', async (_label, returnTo) => {
      const request = await buildWalletTopUpWebhookRequest({
        customer_id: 'customer-1',
        return_to: returnTo,
        transaction_type: 'wallet_topup',
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockNotifyWalletCredited).toHaveBeenCalledWith({
        amount: 20000,
        customerId: 'customer-1',
        merchantId: 'merchant-1',
        returnTo: undefined,
      });
    });

    it('suppresses the wallet-credited push on idempotent webhook replays', async () => {
      vi.useFakeTimers();
      mockCreditWalletTopUp.mockResolvedValueOnce({
        balance: 20000,
        firstCredit: false,
        reference: 'REF123',
        transactionId: 'wallet-credit-1',
      });
      mockClaimWalletCreditPush.mockResolvedValue({
        status: 'already_claimed',
      });
      try {
        const request = await buildWalletTopUpWebhookRequest();
        const response = await POST(request);
        await vi.runAllTimersAsync();

        expect(response.status).toBe(200);
        expect(mockNotifyWalletCredited).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('acknowledges the webhook even when the scheduled push rejects', async () => {
      mockNotifyWalletCredited.mockRejectedValueOnce(new Error('push failed'));
      const request = await buildWalletTopUpWebhookRequest();

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        message: 'Wallet top-up credited',
        reference: 'REF123',
        wallet: { balance: 20000 },
      });
    });

    it('returns wallet-funded order processed responses before plain wallet top-up crediting', async () => {
      const body = {
        event: 'charge.success',
        data: {
          authorization: {
            receiver_bank_account_number: '9812858131',
          },
          reference: 'REF123',
        },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');
      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          amount: 2_000_000,
          channel: 'dedicated_nuban',
          created_at: '2026-05-21T09:59:00Z',
          currency: 'NGN',
          customer: {
            customer_code: 'CUS_test',
            email: 'wallet@example.com',
            first_name: 'Wallet',
            id: 1,
            last_name: null,
            phone: '+2348012345678',
          },
          fees: 30000,
          fees_split: null,
          id: 1,
          metadata: null,
          paid_at: '2026-05-21T10:00:00Z',
          reference: 'REF123',
          status: 'success',
        },
      });
      mockGetPaystackDvaReceiverAccountNumber.mockReturnValue('9812858131');
      mockConfirmPaystackWalletDvaTopUp.mockResolvedValueOnce({
        kind: 'match',
        transaction: {
          amount: 20000,
          currency: 'NGN',
          gateway_reference: 'REF123',
          id: 'wallet-txn-1',
          merchant_id: 'merchant-1',
          metadata: {
            customer_id: 'customer-1',
            transaction_type: 'wallet_topup',
            wallet_payment_account_id: 'wallet-account-1',
          },
          order_id: null,
          platform_fee: 0,
        },
      });
      mockProcessWalletFundedOrderPayment.mockResolvedValueOnce({
        body: {
          fundedAmount: 20000,
          orderId: 'order-1',
          status: 'completed',
        },
        kind: 'processed',
        orderPaid: true,
        status: 200,
      });

      const transactionUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'wallet-txn-1' },
          error: null,
        }),
        neq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
      });
      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          return {
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null,
              error: {
                code: 'PGRST116',
                message: 'Not found',
                details: 'The result contains 0 rows',
              },
            }),
            update: transactionUpdate,
          } as any;
        }
        return {
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        fundedAmount: 20000,
        orderId: 'order-1',
        status: 'completed',
      });
      expect(mockProcessWalletFundedOrderPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          gatewayReference: 'REF123',
          transaction: expect.objectContaining({ id: 'wallet-txn-1' }),
        })
      );
      expect(mockCreditWalletTopUp).not.toHaveBeenCalled();
    });

    it('processes wallet-funded order retries when the transaction update finds no row', async () => {
      const body = {
        event: 'charge.success',
        data: {
          authorization: {
            receiver_bank_account_number: '9812858131',
          },
          reference: 'REF123',
        },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');
      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          amount: 2_000_000,
          channel: 'dedicated_nuban',
          created_at: '2026-05-21T09:59:00Z',
          currency: 'NGN',
          customer: {
            customer_code: 'CUS_test',
            email: 'wallet@example.com',
            first_name: 'Wallet',
            id: 1,
            last_name: null,
            phone: '+2348012345678',
          },
          fees: 30000,
          fees_split: null,
          id: 1,
          metadata: null,
          paid_at: '2026-05-21T10:00:00Z',
          reference: 'REF123',
          status: 'success',
        },
      });
      mockGetPaystackDvaReceiverAccountNumber.mockReturnValue('9812858131');
      mockConfirmPaystackWalletDvaTopUp.mockResolvedValueOnce({
        kind: 'match',
        transaction: {
          amount: 20000,
          currency: 'NGN',
          gateway_reference: 'REF123',
          id: 'wallet-txn-1',
          merchant_id: 'merchant-1',
          metadata: {
            customer_id: 'customer-1',
            transaction_type: 'wallet_topup',
            wallet_payment_account_id: 'wallet-account-1',
          },
          order_id: null,
          platform_fee: 0,
        },
      });
      mockProcessWalletFundedOrderPayment.mockResolvedValueOnce({
        body: {
          fundedAmount: 20000,
          orderId: 'order-1',
          status: 'completed',
        },
        kind: 'processed',
        orderPaid: true,
        status: 200,
      });

      const transactionUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
        neq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
      });
      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          return {
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null,
              error: {
                code: 'PGRST116',
                message: 'Not found',
                details: 'The result contains 0 rows',
              },
            }),
            update: transactionUpdate,
          } as any;
        }
        return {
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        fundedAmount: 20000,
        orderId: 'order-1',
        status: 'completed',
      });
      expect(mockProcessWalletFundedOrderPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          gatewayReference: 'REF123',
          transaction: expect.objectContaining({ id: 'wallet-txn-1' }),
        })
      );
      expect(mockCreditWalletTopUp).not.toHaveBeenCalled();
    });

    it('returns 500 when wallet-funded order processing fails before plain wallet top-up crediting', async () => {
      const body = {
        event: 'charge.success',
        data: {
          authorization: {
            receiver_bank_account_number: '9812858131',
          },
          reference: 'REF123',
        },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');
      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          amount: 2_000_000,
          channel: 'dedicated_nuban',
          created_at: '2026-05-21T09:59:00Z',
          currency: 'NGN',
          customer: {
            customer_code: 'CUS_test',
            email: 'wallet@example.com',
            first_name: 'Wallet',
            id: 1,
            last_name: null,
            phone: '+2348012345678',
          },
          fees: 30000,
          fees_split: null,
          id: 1,
          metadata: null,
          paid_at: '2026-05-21T10:00:00Z',
          reference: 'REF123',
          status: 'success',
        },
      });
      mockGetPaystackDvaReceiverAccountNumber.mockReturnValue('9812858131');
      mockConfirmPaystackWalletDvaTopUp.mockResolvedValueOnce({
        kind: 'match',
        transaction: {
          amount: 20000,
          currency: 'NGN',
          gateway_reference: 'REF123',
          id: 'wallet-txn-1',
          merchant_id: 'merchant-1',
          metadata: {
            customer_id: 'customer-1',
            transaction_type: 'wallet_topup',
            wallet_payment_account_id: 'wallet-account-1',
          },
          order_id: null,
          platform_fee: 0,
        },
      });
      mockProcessWalletFundedOrderPayment.mockRejectedValueOnce(
        new Error('processing failed')
      );

      const transactionUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'wallet-txn-1' },
          error: null,
        }),
        neq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
      });
      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          return {
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: null,
              error: {
                code: 'PGRST116',
                message: 'Not found',
                details: 'The result contains 0 rows',
              },
            }),
            update: transactionUpdate,
          } as any;
        }
        return {
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
      expect(mockProcessWalletFundedOrderPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          gatewayReference: 'REF123',
          transaction: expect.objectContaining({ id: 'wallet-txn-1' }),
        })
      );
      expect(mockCreditWalletTopUp).not.toHaveBeenCalled();
    });

    it('returns wallet DVA review responses without crediting the wallet', async () => {
      const body = {
        event: 'charge.success',
        data: {
          authorization: {
            receiver_bank_account_number: '9812858131',
          },
          reference: 'REF123',
        },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');
      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          id: 1,
          status: 'success',
          amount: 2_000_000,
          reference: 'REF123',
          currency: 'NGN',
          channel: 'dedicated_nuban',
          paid_at: '2026-05-21T10:00:00Z',
          created_at: '2026-05-21T09:59:00Z',
          customer: {
            customer_code: 'CUS_test',
            email: 'wallet@example.com',
            first_name: 'Wallet',
            id: 1,
            last_name: null,
            phone: '+2348012345678',
          },
          metadata: null,
          fees: 30000,
          fees_split: null,
        },
      });
      mockGetPaystackDvaReceiverAccountNumber.mockReturnValue('9812858131');
      mockConfirmPaystackWalletDvaTopUp.mockResolvedValueOnce({
        body: {
          code: 'WALLET_DVA_REVIEW_REQUIRED',
          error: 'Wallet DVA transfer requires review',
        },
        kind: 'review',
        status: 409,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data).toEqual({
        code: 'WALLET_DVA_REVIEW_REQUIRED',
        error: 'Wallet DVA transfer requires review',
      });
      expect(mockCreditWalletTopUp).not.toHaveBeenCalled();
    });

    it('routes Paystack savings auto-debit transactions through the savings handler', async () => {
      const body = {
        event: 'charge.success',
        data: {
          reference: 'SVG-11111111-2026-05-21',
        },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');
      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          id: 1,
          status: 'success',
          amount: 2_000_000,
          reference: 'SVG-11111111-2026-05-21',
          currency: 'NGN',
          channel: 'card',
          paid_at: '2026-05-21T10:00:00Z',
          created_at: '2026-05-21T09:59:00Z',
          customer: {
            customer_code: 'CUS_test',
            email: 'wallet@example.com',
            first_name: 'Wallet',
            id: 1,
            last_name: null,
            phone: '+2348012345678',
          },
          metadata: {
            transaction_type: 'savings_auto_debit',
          },
          fees: 30000,
          fees_split: null,
        },
      });
      mockHandlePaystackSavingsWebhookTransaction.mockResolvedValueOnce({
        body: {
          message: 'Savings auto-debit applied',
          reference: 'SVG-11111111-2026-05-21',
        },
        handled: true,
        status: 200,
      });
      setupSuccessfulTransactionMocks({
        amount: '20000',
        gateway_reference: 'SVG-11111111-2026-05-21',
        metadata: {
          customer_id: 'customer-1',
          goal_id: 'goal-1',
          idempotency_key: 'savings:goal-1:2026-05-21',
          transaction_type: 'savings_auto_debit',
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        message: 'Savings auto-debit applied',
        reference: 'SVG-11111111-2026-05-21',
      });
      expect(mockHandlePaystackSavingsWebhookTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          paystackSignature: { verified: true },
          reference: 'SVG-11111111-2026-05-21',
          transaction: expect.objectContaining({
            metadata: expect.objectContaining({
              transaction_type: 'savings_auto_debit',
            }),
          }),
        })
      );
    });

    it('routes duplicate Paystack savings webhooks through the savings handler when the transaction is already completed', async () => {
      const body = {
        event: 'charge.success',
        data: {
          reference: 'SVG-11111111-2026-05-21',
        },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');
      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          id: 1,
          status: 'success',
          amount: 2_000_000,
          reference: 'SVG-11111111-2026-05-21',
          currency: 'NGN',
          channel: 'card',
          paid_at: '2026-05-21T10:00:00Z',
          created_at: '2026-05-21T09:59:00Z',
          customer: {
            customer_code: 'CUS_test',
            email: 'wallet@example.com',
            first_name: 'Wallet',
            id: 1,
            last_name: null,
            phone: '+2348012345678',
          },
          metadata: {
            transaction_type: 'savings_auto_debit',
          },
          fees: 30000,
          fees_split: null,
        },
      });
      mockHandlePaystackSavingsWebhookTransaction.mockResolvedValueOnce({
        body: {
          message: 'Savings auto-debit applied',
          reference: 'SVG-11111111-2026-05-21',
        },
        handled: true,
        status: 200,
      });
      setupSuccessfulTransactionMocks(
        {
          amount: '20000',
          gateway_reference: 'SVG-11111111-2026-05-21',
          metadata: {
            customer_id: 'customer-1',
            goal_id: 'goal-1',
            idempotency_key: 'savings:goal-1:2026-05-21',
            transaction_type: 'savings_auto_debit',
          },
          status: 'completed',
        },
        { updatedTransaction: null }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        message: 'Savings auto-debit applied',
        reference: 'SVG-11111111-2026-05-21',
      });
      expect(mockHandlePaystackSavingsWebhookTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          paystackSignature: { verified: true },
          reference: 'SVG-11111111-2026-05-21',
        })
      );
    });

    it('propagates savings webhook handler failures', async () => {
      const body = {
        event: 'charge.success',
        data: {
          reference: 'SVG-11111111-2026-05-21',
        },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');
      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          id: 1,
          status: 'success',
          amount: 2_000_000,
          reference: 'SVG-11111111-2026-05-21',
          currency: 'NGN',
          channel: 'card',
          paid_at: '2026-05-21T10:00:00Z',
          created_at: '2026-05-21T09:59:00Z',
          customer: {
            customer_code: 'CUS_test',
            email: 'wallet@example.com',
            first_name: 'Wallet',
            id: 1,
            last_name: null,
            phone: '+2348012345678',
          },
          metadata: {
            transaction_type: 'savings_auto_debit',
          },
          fees: 30000,
          fees_split: null,
        },
      });
      mockHandlePaystackSavingsWebhookTransaction.mockResolvedValueOnce({
        body: { error: 'Savings contribution failed' },
        handled: true,
        status: 500,
      });
      setupSuccessfulTransactionMocks({
        amount: '20000',
        gateway_reference: 'SVG-11111111-2026-05-21',
        metadata: {
          customer_id: 'customer-1',
          goal_id: 'goal-1',
          idempotency_key: 'savings:goal-1:2026-05-21',
          transaction_type: 'savings_auto_debit',
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({ error: 'Savings contribution failed' });
    });

    it('does not route Korapay webhooks with savings metadata through the Paystack savings handler', async () => {
      const body = {
        event: 'charge.success',
        data: {
          reference: 'KORA-SVG-1',
          status: 'success',
          metadata: {
            transaction_type: 'savings_auto_debit',
          },
        },
      };
      const signature = createKorapaySignature(
        body.data,
        'test-korapay-secret'
      );
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          amount: 20_000,
          created_at: '2026-05-21T09:59:00Z',
          currency: 'NGN',
          customer: { email: 'savings@example.com', name: 'Savings Customer' },
          paid_at: '2026-05-21T10:00:00Z',
          reference: 'KORA-SVG-1',
          status: 'success',
        },
      });
      setupSuccessfulTransactionMocks({
        amount: '20000',
        currency: 'NGN',
        gateway_reference: 'KORA-SVG-1',
        metadata: {
          customer_id: 'customer-1',
          transaction_type: 'savings_auto_debit',
        },
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        message: 'Payment processed successfully',
        success: true,
      });
      expect(
        mockHandlePaystackSavingsWebhookTransaction
      ).not.toHaveBeenCalled();
    });
  });

  describe('Success Path', () => {
    it('uses the database-generated order number when converting chat orders', async () => {
      const body = {
        reference: 'CHAT-REF123',
        status: 'success',
        event: 'charge.success',
        amount: 11000,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');

      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      const { notifyNewOrder, notifyPaymentReceived } = await import(
        '@/lib/expo-push'
      );
      const { sendEmail } = await import('@/lib/zeptomail');

      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 11000,
          reference: 'CHAT-REF123',
          currency: 'NGN',
          paid_at: '2026-03-23T10:00:00Z',
          created_at: '2026-03-23T10:00:00Z',
          customer: { name: 'Jane Doe', email: 'jane@example.com' },
        },
      });

      const chatOrder = {
        id: 'chat-order-123',
        merchant_id: 'merchant-123',
        customer_id: 'customer-123',
        customer_name: 'Jane Doe',
        customer_email: 'jane@example.com',
        customer_phone: '+2348012345678',
        shipping_address: {
          address: '123 Example Street',
          city: 'Lagos',
          state: 'Lagos',
        },
        session_id: 'session-123',
        subtotal: '10000',
        shipping_fee: '1000',
        items: [
          {
            product_id: 'product-1',
            variant_id: 'variant-1',
            name: 'Chat Product',
            quantity: 1,
            price: 10000,
            image_url: 'https://example.com/product.png',
          },
        ],
        status: 'pending_payment',
      };

      const chatOrdersLookupQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: chatOrder,
          error: null,
        }),
      };

      const merchantsQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            business_name: 'Test Store',
            slug: 'test-store',
            support_email: 'support@test-store.com',
            email_sender_name: 'Test Store',
            email: 'hello@test-store.com',
            tax_identification_number: null,
            cac_rc_number: null,
          },
          error: null,
        }),
      };

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'chat_orders') {
          return chatOrdersLookupQuery as any;
        }

        if (table === 'merchants') {
          return merchantsQuery as any;
        }

        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      vi.mocked(mockServiceClient.rpc).mockImplementation(
        (name: string, _args?: any) => {
          if (name === 'convert_chat_order_to_paid_order_with_inventory') {
            const result = {
              data: {
                success: true,
                order_id: 'order-123',
                order_number: 'ORD-260323-A7K3-2',
                already_processed: false,
              },
              error: null,
            };
            return Object.assign(Promise.resolve(result), {
              single: () => Promise.resolve(result),
            }) as never;
          }
          if (name === 'claim_payment_side_effect') {
            const result = {
              data: { we_won: true, current_status: 'claimed' },
              error: null,
            };
            return Object.assign(Promise.resolve(result), {
              single: () => Promise.resolve(result),
            }) as never;
          }
          const result = { data: null, error: null };
          return Object.assign(Promise.resolve(result), {
            single: () => Promise.resolve(result),
          }) as never;
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toMatchObject({
        success: true,
        orderId: 'order-123',
        orderNumber: 'ORD-260323-A7K3-2',
      });
      expect(vi.mocked(notifyNewOrder)).toHaveBeenCalledWith(
        'merchant-123',
        'order-123',
        'ORD-260323-A7K3-2',
        'Jane Doe',
        11000,
        'NGN'
      );
      expect(vi.mocked(notifyPaymentReceived)).toHaveBeenCalledWith(
        'merchant-123',
        11000,
        'NGN',
        'ORD-260323-A7K3-2',
        'order-123'
      );
      expect(vi.mocked(sendEmail)).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Order Confirmation - #ORD-260323-A7K3-2',
        })
      );
    });

    it('returns 200 when chat order was already claimed before conversion', async () => {
      const body = {
        reference: 'CHAT-REF123',
        status: 'success',
        event: 'charge.success',
        amount: 11000,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 11000,
          reference: 'CHAT-REF123',
          currency: 'NGN',
          paid_at: '2026-03-23T10:00:00Z',
          created_at: '2026-03-23T10:00:00Z',
          customer: { name: 'Jane Doe', email: 'jane@example.com' },
        },
      });

      const chatOrder = {
        id: 'chat-order-123',
        merchant_id: 'merchant-123',
        customer_id: 'customer-123',
        customer_name: 'Jane Doe',
        customer_email: 'jane@example.com',
        customer_phone: '+2348012345678',
        shipping_address: { address: '123 Example Street' },
        session_id: 'session-123',
        subtotal: '10000',
        shipping_fee: '1000',
        items: [],
        status: 'completed',
      };

      const chatOrdersLookupQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: chatOrder,
          error: null,
        }),
      };

      const ordersQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'order-123',
            order_number: 'ORD-260323-A7K3-2',
          },
          error: null,
        }),
      };

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'chat_orders') {
          return chatOrdersLookupQuery as any;
        }

        if (table === 'orders') {
          return ordersQuery as any;
        }

        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        message: 'Already processed',
        orderId: 'order-123',
        orderNumber: 'ORD-260323-A7K3-2',
      });
    });

    it('returns 409 when strict serialized inventory is unavailable during conversion', async () => {
      const body = {
        reference: 'CHAT-REF123',
        status: 'success',
        event: 'charge.success',
        amount: 11000,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 11000,
          reference: 'CHAT-REF123',
          currency: 'NGN',
          paid_at: '2026-03-23T10:00:00Z',
          created_at: '2026-03-23T10:00:00Z',
          customer: { name: 'Jane Doe', email: 'jane@example.com' },
        },
      });

      const chatOrder = {
        id: 'chat-order-123',
        merchant_id: 'merchant-123',
        customer_id: 'customer-123',
        customer_name: 'Jane Doe',
        customer_email: 'jane@example.com',
        customer_phone: '+2348012345678',
        shipping_address: { address: '123 Example Street' },
        session_id: 'session-123',
        subtotal: '10000',
        shipping_fee: '1000',
        items: [],
        status: 'pending_payment',
      };

      const chatOrdersLookupQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: chatOrder,
          error: null,
        }),
      };

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'chat_orders') {
          return chatOrdersLookupQuery as any;
        }

        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        if (name === 'convert_chat_order_to_paid_order_with_inventory') {
          const result = {
            data: null,
            error: {
              message: 'serialized_inventory_unavailable',
              code: '55000',
            },
          };
          return Object.assign(Promise.resolve(result), {
            single: () => Promise.resolve(result),
          }) as never;
        }
        const result = { data: null, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data).toEqual({
        error: 'serialized_inventory_unavailable',
        code: 'serialized_inventory_unavailable',
      });
    });

    it('does not run chat-order side effects when conversion reports failure', async () => {
      const body = {
        reference: 'CHAT-REF123',
        status: 'success',
        event: 'charge.success',
        amount: 11000,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { after } = await import('next/server');
      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 11000,
          reference: 'CHAT-REF123',
          currency: 'NGN',
          paid_at: '2026-03-23T10:00:00Z',
          created_at: '2026-03-23T10:00:00Z',
          customer: { name: 'Jane Doe', email: 'jane@example.com' },
        },
      });

      const chatOrder = {
        id: 'chat-order-123',
        merchant_id: 'merchant-123',
        customer_id: 'customer-123',
        customer_name: 'Jane Doe',
        customer_email: 'jane@example.com',
        customer_phone: '+2348012345678',
        shipping_address: { address: '123 Example Street' },
        session_id: 'session-123',
        subtotal: '10000',
        shipping_fee: '1000',
        items: [],
        status: 'pending_payment',
      };

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'chat_orders') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: chatOrder,
              error: null,
            }),
          } as never;
        }

        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as never;
      });

      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        if (name === 'convert_chat_order_to_paid_order_with_inventory') {
          const result = {
            data: {
              already_processed: false,
              order_id: 'order-123',
              order_number: 'ORD-260323-A7K3-2',
              success: false,
            },
            error: null,
          };
          return Object.assign(Promise.resolve(result), {
            single: () => Promise.resolve(result),
          }) as never;
        }
        const result = { data: null, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({ error: 'Failed to convert chat order' });
      expect(after).not.toHaveBeenCalled();
    });

    it('returns 200 and processes valid webhook successfully', async () => {
      const body = {
        reference: 'REF123',
        status: 'success',
        event: 'charge.success',
        amount: 1000,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');

      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 1000,
          reference: 'REF123',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      // Setup complex mock for success path with order
      let transactionCallCount = 0;
      let _merchantCallCount = 0;
      let _orderCallCount = 0;
      const orderSelect = vi.fn().mockReturnThis();

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          transactionCallCount++;
          if (transactionCallCount === 1) {
            // First call: transaction lookup
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'txn-123',
                  merchant_id: 'merchant-123',
                  order_id: 'order-123',
                  amount: '1000',
                  currency: 'NGN',
                  gateway_reference: 'BAC-REF123',
                  status: 'pending',
                  metadata: {},
                },
                error: null,
              }),
            } as any;
          }
          if (transactionCallCount === 2) {
            // Second call: transaction update
            return {
              update: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              neq: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'txn-123' },
                error: null,
              }),
            } as any;
          }
        }

        if (table === 'orders') {
          _orderCallCount++;
          // Order update
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: orderSelect,
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'order-123',
                order_number: 'ORD-123',
                customer_name: 'John Doe',
                customer_email: 'john@example.com',
                customer_phone: '+234',
                total: '1000',
                subtotal: '900',
                shipping_fee: '100',
                currency: 'NGN',
                shipping_address: {},
                order_items: [],
              },
              error: null,
            }),
          } as any;
        }

        if (table === 'merchants') {
          _merchantCallCount++;
          // Merchant fetch
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'merchant-123',
                business_name: 'Test Store',
                slug: 'test-store',
                email: 'merchant@example.com',
              },
              error: null,
            }),
          } as any;
        }

        // Default chain
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as any;
      });

      // Mock RPC call for settlement (and the atomic order-completion RPC
      // that runs before it in finalizeOrderGatewayPayment).
      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        let data: unknown = null;
        if (name === 'claim_payment_side_effect') {
          data = { we_won: true, current_status: 'claimed' };
        } else if (name === 'complete_order_gateway_payment') {
          data = {
            actor: null,
            already_completed: false,
            order_already_paid: false,
            order_updated: true,
            order_cancelled: false,
            order_skipped_status: null,
            previous_payment_status: 'pending',
            previous_shipping_status: 'pending',
            payment_status: 'paid',
            shipping_status: 'processing',
            cancelled_at: null,
            order_number: 'ORD-123',
          };
        }
        const result = { data, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toMatchObject({
        success: true,
        message: 'Payment processed successfully',
      });
      const selectArg = orderSelect.mock.calls[0]?.[0];
      expect(selectArg).toContain(
        'order_items(id, product_id, condition, name, price, quantity, variant_name)'
      );
      const orderItemsProjection =
        selectArg?.match(/order_items\(([^)]*)\)/)?.[1] ?? '';
      expect(orderItemsProjection).not.toContain('subtotal');

      // Review feedback: assert the shared side-effect runner receives the
      // BAC-* canonical key and the external gateway reference separately. The
      // runner owns the actual record_merchant_settlement RPC now so
      // wallet-funded orders can reuse the same behavior.
      expect(mockRunPaidOrderSideEffects).toHaveBeenCalledWith(
        expect.objectContaining({
          externalGatewayReference: 'REF123',
          settlementGateway: 'korapay',
          transaction: expect.objectContaining({
            gateway_reference: 'BAC-REF123',
          }),
        })
      );
    });

    it('returns 409 without paid-order side effects when standard order inventory is unavailable', async () => {
      const body = {
        reference: 'REF-INV-MISSING',
        status: 'success',
        event: 'charge.success',
        amount: 1000,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 1000,
          reference: 'REF-INV-MISSING',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      let transactionCallCount = 0;

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          transactionCallCount++;
          if (transactionCallCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'txn-123',
                  merchant_id: 'merchant-123',
                  order_id: 'order-123',
                  amount: '1000',
                  currency: 'NGN',
                  gateway_reference: 'BAC-REF-INV-MISSING',
                  status: 'pending',
                  metadata: {},
                },
                error: null,
              }),
            } as never;
          }
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: { id: 'txn-123' }, error: null }),
          } as never;
        }

        if (table === 'orders') {
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'order-123',
                order_number: 'ORD-123',
                customer_name: 'John Doe',
                customer_email: 'john@example.com',
                customer_phone: '+234',
                total: '1000',
                subtotal: '900',
                shipping_fee: '100',
                currency: 'NGN',
                shipping_address: {},
                order_items: [],
              },
              error: null,
            }),
          } as never;
        }

        if (table === 'payment_side_effects') {
          const expectedFilters: [string, string][] = [
            ['order_id', 'order-123'],
            ['transaction_id', 'txn-123'],
            ['status', 'failed'],
            ['error', 'rpc_seed_pending_drain'],
          ];
          let eqCallCount = 0;
          const query = {
            delete: vi.fn(() => query),
            eq: vi.fn((column: string, value: string) => {
              const expectedFilter = expectedFilters[eqCallCount];
              if (
                !expectedFilter ||
                column !== expectedFilter[0] ||
                value !== expectedFilter[1]
              ) {
                throw new Error(
                  `Unexpected payment_side_effects filter: ${column}=${value}`
                );
              }
              eqCallCount++;
              return eqCallCount === expectedFilters.length
                ? Promise.resolve({ error: null })
                : query;
            }),
          };
          return query as never;
        }

        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as never;
      });

      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        if (name === 'confirm_order_inventory_reservations') {
          const result = {
            data: {
              alreadyConfirmed: 0,
              confirmedUnitCount: 0,
              exceptionCodes: [
                { itemId: 'item-1', code: 'late_payment_reservation_lost' },
              ],
              missingUnitCount: 1,
              reclaimedUnitCount: 0,
            },
            error: null,
          };
          return Object.assign(Promise.resolve(result), {
            single: () => Promise.resolve(result),
          }) as never;
        }

        // The atomic completion RPC must succeed so finalizeOrderGatewayPayment
        // reaches the inventory-confirmation step tested here.
        if (name === 'complete_order_gateway_payment') {
          const result = {
            data: {
              actor: null,
              already_completed: false,
              order_already_paid: false,
              order_updated: true,
              order_cancelled: false,
              order_skipped_status: null,
              previous_payment_status: 'pending',
              previous_shipping_status: 'pending',
              payment_status: 'paid',
              shipping_status: 'processing',
              cancelled_at: null,
              order_number: 'ORD-123',
            },
            error: null,
          };
          return Object.assign(Promise.resolve(result), {
            single: () => Promise.resolve(result),
          }) as never;
        }

        const result = { data: null, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data).toEqual({
        code: 'serialized_inventory_unavailable',
        error: 'serialized_inventory_unavailable',
      });
      expect(mockRunPaidOrderSideEffects).not.toHaveBeenCalled();
    });

    it('suppresses paid-order side effects and files reconciliation when the order was clamped as cancelled', async () => {
      const body = {
        reference: 'REF-CANCELLED-1',
        status: 'success',
        event: 'charge.success',
        amount: 1000,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 1000,
          reference: 'REF-CANCELLED-1',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      let transactionCallCount = 0;

      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          transactionCallCount++;
          if (transactionCallCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'txn-123',
                  merchant_id: 'merchant-123',
                  order_id: 'order-123',
                  amount: '1000',
                  currency: 'NGN',
                  gateway_reference: 'BAC-REF-CANCELLED-1',
                  status: 'pending',
                  metadata: {},
                },
                error: null,
              }),
            } as never;
          }
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: { id: 'txn-123' }, error: null }),
          } as never;
        }

        // The atomic RPC now signals the clamp: finalizeOrderGatewayPayment
        // returns 'order_cancelled' before ever reading/writing `orders`, so
        // no `.from('orders')` mock is needed for this scenario.
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as never;
      });

      // The order was cancelled before this payment landed: the
      // complete_order_gateway_payment RPC's prevent_cancelled_order_reopen
      // trigger clamps it and reports order_cancelled instead of flipping it
      // to paid.
      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        const data =
          name === 'complete_order_gateway_payment'
            ? {
                actor: null,
                already_completed: false,
                order_already_paid: false,
                order_updated: false,
                order_cancelled: true,
                order_skipped_status: null,
                previous_payment_status: 'unpaid',
                previous_shipping_status: 'cancelled',
                payment_status: 'unpaid',
                shipping_status: 'cancelled',
                cancelled_at: '2026-01-01T00:00:00Z',
                order_number: 'ORD-123',
              }
            : null;
        const result = { data, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toMatchObject({ success: true });
      // No paid-order side effects ran.
      expect(mockRunPaidOrderSideEffects).not.toHaveBeenCalled();
      // Reconciliation row was filed through the service-role admin client.
      expect(mockReconciliationInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_type: 'payment_received_after_cancellation',
          order_id: 'order-123',
        })
      );
    });

    it('acknowledges completed payments when paid-order side effects throw', async () => {
      const body = {
        reference: 'REF-SIDE-EFFECT-1',
        status: 'success',
        event: 'charge.success',
        amount: 1000,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });
      const { logger } = await import('@/lib/logger');
      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          amount: 1000,
          created_at: '2026-01-01T00:00:00Z',
          currency: 'NGN',
          customer: { email: 'test@example.com', name: 'Test' },
          paid_at: '2026-01-01T00:00:00Z',
          reference: 'REF-SIDE-EFFECT-1',
          status: 'success',
        },
      });
      mockRunPaidOrderSideEffects.mockRejectedValueOnce(
        new Error('side effects unavailable')
      );
      const retryUpsert = vi.fn(async () => ({ data: null, error: null }));

      let transactionCallCount = 0;
      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          transactionCallCount += 1;
          if (transactionCallCount === 1) {
            return {
              eq: vi.fn().mockReturnThis(),
              select: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  amount: '1000',
                  currency: 'NGN',
                  gateway_reference: 'REF-SIDE-EFFECT-1',
                  id: 'txn-side-effect-1',
                  merchant_id: 'merchant-123',
                  metadata: {},
                  order_id: 'order-123',
                  status: 'pending',
                },
                error: null,
              }),
            } as never;
          }
          return {
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'txn-side-effect-1' },
              error: null,
            }),
            neq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
          } as never;
        }

        if (table === 'orders') {
          return {
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                currency: 'NGN',
                customer_email: 'john@example.com',
                customer_name: 'John Doe',
                customer_phone: '+234',
                id: 'order-123',
                merchant_id: 'merchant-123',
                order_items: [],
                order_number: 'ORD-123',
                shipping_address: {},
                shipping_fee: '100',
                subtotal: '900',
                total: '1000',
              },
              error: null,
            }),
            update: vi.fn().mockReturnThis(),
          } as never;
        }

        if (table === 'payment_side_effects') {
          return {
            upsert: retryUpsert,
          } as never;
        }

        return {
          eq: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockReturnThis(),
        } as never;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toMatchObject({
        message: 'Payment processed successfully',
        success: true,
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Paid order side effects failed after payment completion',
          orderId: 'order-123',
          reference: 'REF-SIDE-EFFECT-1',
          transactionId: 'txn-side-effect-1',
        })
      );
      expect(retryUpsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            order_id: 'order-123',
            status: 'failed',
            step: 'paid_email',
            transaction_id: 'txn-side-effect-1',
          }),
          expect.objectContaining({
            order_id: 'order-123',
            status: 'failed',
            step: 'ad_tracking_conversion',
            transaction_id: 'txn-side-effect-1',
          }),
          expect.objectContaining({
            order_id: 'order-123',
            status: 'failed',
            step: 'merchant_settlement',
            transaction_id: 'txn-side-effect-1',
          }),
        ]),
        { onConflict: 'order_id,step' }
      );
    });

    it('records settlement via fallback path and fails closed for gateway retry when the atomic completion RPC fails (review #1563 P1 regression test)', async () => {
      // Review feedback (CodeRabbit P1): the fallback I added in
      // commit fa3cc0eb1e — when order-completion fails (transient DB blip /
      // missing row), settlement must still be recorded via a direct
      // record_merchant_settlement RPC call so the merchant isn't left
      // uncredited. Idempotency from the A0 partial unique index ensures a
      // later replay with a successful completion is a no-op.
      //
      // Post-atomic-RPC update: the order flip and the transaction flip now
      // happen together inside `complete_order_gateway_payment`, so "the
      // order update failed" is represented by that RPC returning an
      // error_code. The old swallow-to-200 behavior wedged a real order
      // (ORD-260711-00NT-5) — the webhook now fails closed with 500 so the
      // gateway redelivers and the redelivery path heals the order.
      const body = {
        reference: 'REF-FB-1',
        status: 'success',
        event: 'charge.success',
        amount: 1000,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 1000,
          reference: 'REF-FB-1',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      let transactionCallCount = 0;
      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          transactionCallCount++;
          if (transactionCallCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'txn-fb-1',
                  merchant_id: 'merchant-fb-1',
                  order_id: 'order-fb-1',
                  amount: '1000',
                  currency: 'NGN',
                  gateway_reference: 'BAC-FB-1',
                  status: 'pending',
                  metadata: {},
                },
                error: null,
              }),
            } as never;
          }
          // Subsequent calls: transaction update (mark completed)
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'txn-fb-1' },
              error: null,
            }),
          } as never;
        }

        // finalizeOrderGatewayPayment fails at the atomic RPC step below,
        // before ever reading/writing `orders` for completion — the fallback
        // path still loads order economics for GIGL settlement routing.
        if (table === 'orders') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          } as never;
        }
        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as never;
      });

      // CRITICAL: simulate the atomic completion RPC failing (transient DB
      // blip / missing row). Before the fa3cc0eb1e fix this would silently
      // leave the merchant uncredited; after it, settlement still runs via
      // the fallback path even though the webhook now fails closed overall.
      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        if (name === 'complete_order_gateway_payment') {
          const result = {
            data: { error_code: 'ORDER_NOT_FOUND' },
            error: null,
          };
          return Object.assign(Promise.resolve(result), {
            single: () => Promise.resolve(result),
          }) as never;
        }
        const result = { data: null, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const response = await POST(request);
      const data = await response.json();

      // The webhook fails closed so the gateway redelivers — the redelivery
      // path re-reads the order and heals the flip (unlike the historical
      // swallow-to-200 behavior that wedged ORD-260711-00NT-5).
      expect(response.status).toBe(500);
      expect(data).toEqual({
        code: 'ORDER_PAYMENT_COMPLETION_FAILED',
        error: 'Order payment completion failed',
      });

      // The whole point of the fix: even though the order-completion RPC
      // failed, record_merchant_settlement was called with the BAC-*
      // canonical key + the order_update_failed metadata flag so ops
      // can spot fallback-path settlements.
      expect(mockServiceClient.rpc).toHaveBeenCalledWith(
        'record_merchant_settlement',
        expect.objectContaining({
          p_gateway_reference: 'BAC-FB-1',
          p_source_type: 'order',
          p_source_id: 'order-fb-1',
          p_metadata: expect.objectContaining({
            korapay_reference: 'REF-FB-1',
            order_update_failed: true,
          }),
        })
      );
    });

    it('does not record settlement when completion-failure fallback economics lookup errors', async () => {
      const body = {
        reference: 'REF-FB-ECON-ERR',
        status: 'success',
        event: 'charge.success',
        amount: 1000,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 1000,
          reference: 'REF-FB-ECON-ERR',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      let transactionCallCount = 0;
      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          transactionCallCount++;
          if (transactionCallCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'txn-fb-econ-err',
                  merchant_id: 'merchant-fb-econ-err',
                  order_id: 'order-fb-econ-err',
                  amount: '1000',
                  currency: 'NGN',
                  gateway_reference: 'BAC-FB-ECON-ERR',
                  status: 'pending',
                  metadata: {},
                },
                error: null,
              }),
            } as never;
          }
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'txn-fb-econ-err' },
              error: null,
            }),
          } as never;
        }

        if (table === 'orders') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'transient economics lookup failure' },
            }),
          } as never;
        }

        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as never;
      });

      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        if (name === 'complete_order_gateway_payment') {
          const result = {
            data: { error_code: 'ORDER_NOT_FOUND' },
            error: null,
          };
          return Object.assign(Promise.resolve(result), {
            single: () => Promise.resolve(result),
          }) as never;
        }
        const result = { data: null, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        code: 'ORDER_PAYMENT_COMPLETION_FAILED',
        error: 'Order payment completion failed',
      });
      expect(mockServiceClient.rpc).not.toHaveBeenCalledWith(
        'record_merchant_settlement',
        expect.anything()
      );
      expect(mockServiceClient.rpc).not.toHaveBeenCalledWith(
        'record_merchant_settlement_gigl_v1',
        expect.anything()
      );
    });

    it('routes completion-failure fallback settlements through the GIGL wrapper for GIGL orders', async () => {
      const body = {
        reference: 'REF-FB-GIGL',
        status: 'success',
        event: 'charge.success',
        amount: 1000,
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-korapay-secret');
      const request = createMockRequest(body, {
        'x-korapay-signature': signature,
      });

      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 1000,
          reference: 'REF-FB-GIGL',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      let transactionCallCount = 0;
      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          transactionCallCount++;
          if (transactionCallCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'txn-fb-gigl',
                  merchant_id: 'merchant-fb-gigl',
                  order_id: 'order-fb-gigl',
                  amount: '1000',
                  currency: 'NGN',
                  gateway_reference: 'BAC-FB-GIGL',
                  status: 'pending',
                  metadata: {},
                },
                error: null,
              }),
            } as never;
          }
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'txn-fb-gigl' },
              error: null,
            }),
          } as never;
        }

        if (table === 'orders') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                shipping_funding_source: 'customer_checkout',
                shipping_platform_retained_amount: 250,
                shipping_provider: 'GIGL',
              },
              error: null,
            }),
          } as never;
        }

        return {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        } as never;
      });

      vi.mocked(mockServiceClient.rpc).mockImplementation((name: string) => {
        if (name === 'complete_order_gateway_payment') {
          const result = {
            data: { error_code: 'ORDER_NOT_FOUND' },
            error: null,
          };
          return Object.assign(Promise.resolve(result), {
            single: () => Promise.resolve(result),
          }) as never;
        }
        const result = { data: null, error: null };
        return Object.assign(Promise.resolve(result), {
          single: () => Promise.resolve(result),
        }) as never;
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      expect(mockServiceClient.rpc).toHaveBeenCalledWith(
        'record_merchant_settlement_gigl_v1',
        expect.objectContaining({
          p_gateway_reference: 'BAC-FB-GIGL',
          p_source_id: 'order-fb-gigl',
          p_metadata: expect.objectContaining({
            commerce_platform_fee: expect.any(Number),
            order_update_failed: true,
            retained_shipping_amount: 250,
          }),
        })
      );
    });

    it('returns retryable status when agentic session reconciliation fails after payment processing', async () => {
      const body = {
        event: 'charge.success',
        data: { reference: 'REF123' },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');
      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });
      const { logger } = await import('@/lib/logger');
      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          id: 1,
          status: 'success',
          amount: 100000,
          reference: 'REF123',
          currency: 'NGN',
          channel: 'bank_transfer',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: {
            customer_code: 'CUS_test',
            email: 'test@example.com',
            first_name: 'Test',
            id: 1,
            last_name: null,
            phone: null,
          },
          metadata: null,
          fees: 0,
          fees_split: null,
        },
      });
      mockMarkAgenticPaystackDvaSessionPaid.mockResolvedValueOnce({
        error: 'session update failed',
        ok: false,
      });

      let transactionCallCount = 0;
      vi.mocked(mockServiceClient.from).mockImplementation((table: string) => {
        if (table === 'transactions') {
          transactionCallCount++;
          if (transactionCallCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'txn-123',
                  merchant_id: 'merchant-123',
                  order_id: 'order-123',
                  amount: '1000',
                  currency: 'NGN',
                  gateway_reference: 'REF123',
                  status: 'pending',
                  metadata: {
                    transaction_type: 'agentic_checkout_payment',
                  },
                },
                error: null,
              }),
            } as any;
          }
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            neq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'txn-123' },
              error: null,
            }),
          } as any;
        }
        if (table === 'orders') {
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'order-123',
                order_number: 'ORD-123',
                customer_name: 'John Doe',
                customer_email: 'john@example.com',
                total: '1000',
                subtotal: '900',
                shipping_fee: '100',
                currency: 'NGN',
                order_items: [],
              },
              error: null,
            }),
          } as any;
        }
        if (table === 'merchants') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'merchant-123', business_name: 'Test Store' },
              error: null,
            }),
          } as any;
        }
        // A1: payment_side_effects mark-completed/failed UPDATE chain
        // (chainable + thenable so the helper resolves to data: []).
        if (table === 'payment_side_effects') {
          const chain: any = {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock so the A1 outbox helper's `await supabase.from(...).update(...).eq(...).select('order_id')` chain resolves.
            then: (onFulfilled: any) =>
              Promise.resolve({ data: [], error: null }).then(onFulfilled),
          };
          return chain;
        }
        throw new Error(`Unexpected table ${table}`);
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toMatchObject({
        error: 'Agentic checkout session reconciliation failed',
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Agentic checkout session reconciliation failed',
          reference: 'REF123',
        })
      );
    });
  });

  it('rejects an unsigned dedicated-account assignment before persistence', async () => {
    const body = {
      event: 'dedicatedaccount.assign.success',
      data: {
        metadata: {
          source: 'merchant_wallet_funding',
          request_id: 'r',
          merchant_id: 'm',
        },
        dedicated_account: { account_number: '1234567890', currency: 'NGN' },
      },
    };
    const response = await POST(
      createMockRequest(body, { 'x-paystack-signature': 'invalid-signature' })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Invalid signature' });
    expect(mockPersistMerchantWalletAssignmentEvent).not.toHaveBeenCalled();
  });

  it('handles a signed dedicated-account assignment before charge logic', async () => {
    mockPersistMerchantWalletAssignmentEvent.mockResolvedValue({
      kind: 'match',
    });
    const body = {
      event: 'dedicatedaccount.assign.success',
      data: {
        metadata: {
          source: 'merchant_wallet_funding',
          request_id: 'r',
          merchant_id: 'm',
        },
        dedicated_account: { account_number: '1234567890', currency: 'NGN' },
      },
    };
    const response = await POST(
      createMockRequest(body, {
        'x-paystack-signature': createSignature(
          JSON.stringify(body),
          'test-paystack-secret'
        ),
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      handled: 'merchant_wallet_assignment',
    });
    expect(mockPersistMerchantWalletAssignmentEvent).toHaveBeenCalled();
  });

  it('acknowledges an alias-conflicted assignment after the pending request is failed', async () => {
    mockPersistMerchantWalletAssignmentEvent.mockResolvedValue({
      kind: 'conflict',
    });
    const body = {
      event: 'dedicatedaccount.assign.success',
      data: {
        metadata: {
          source: 'merchant_wallet_funding',
          request_id: 'r',
          merchant_id: 'm',
        },
        dedicated_account: { account_number: '1234567890', currency: 'NGN' },
      },
    };
    const response = await POST(
      createMockRequest(body, {
        'x-paystack-signature': createSignature(
          JSON.stringify(body),
          'test-paystack-secret'
        ),
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      handled: 'merchant_wallet_alias_conflict',
    });
  });

  it('acknowledges an alias-conflicted assignment after the pending request is failed', async () => {
    mockPersistMerchantWalletAssignmentEvent.mockResolvedValue({
      kind: 'conflict',
    });
    const body = {
      event: 'dedicatedaccount.assign.success',
      data: {
        metadata: {
          source: 'merchant_wallet_funding',
          request_id: 'r',
          merchant_id: 'm',
        },
        dedicated_account: { account_number: '1234567890', currency: 'NGN' },
      },
    };
    const response = await POST(
      createMockRequest(body, {
        'x-paystack-signature': createSignature(
          JSON.stringify(body),
          'test-paystack-secret'
        ),
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      handled: 'merchant_wallet_alias_conflict',
    });
  });

  it('acknowledges an alias-conflicted assignment after the pending request is failed', async () => {
    mockPersistMerchantWalletAssignmentEvent.mockResolvedValue({
      kind: 'conflict',
    });
    const body = {
      event: 'dedicatedaccount.assign.success',
      data: {
        metadata: {
          source: 'merchant_wallet_funding',
          request_id: 'r',
          merchant_id: 'm',
        },
        dedicated_account: { account_number: '1234567890', currency: 'NGN' },
      },
    };
    const response = await POST(
      createMockRequest(body, {
        'x-paystack-signature': createSignature(
          JSON.stringify(body),
          'test-paystack-secret'
        ),
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      handled: 'merchant_wallet_alias_conflict',
    });
  });

  it('handles a signed dedicated-account assignment failure by marking the request retryable', async () => {
    mockFailMerchantWalletAssignmentEvent.mockResolvedValue({
      kind: 'match',
    });
    const body = {
      event: 'dedicatedaccount.assign.failed',
      data: {
        metadata: {
          source: 'merchant_wallet_funding',
          request_id: 'r',
          merchant_id: 'm',
        },
      },
    };
    const response = await POST(
      createMockRequest(body, {
        'x-paystack-signature': createSignature(
          JSON.stringify(body),
          'test-paystack-secret'
        ),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      handled: 'merchant_wallet_assignment_failure',
    });
    expect(mockFailMerchantWalletAssignmentEvent).toHaveBeenCalledWith(
      expect.anything(),
      body
    );
    expect(mockPersistMerchantWalletAssignmentEvent).not.toHaveBeenCalled();
  });

  it('rejects an unsigned dedicated-account assignment failure before transition', async () => {
    const body = {
      event: 'dedicatedaccount.assign.failed',
      data: {
        metadata: {
          source: 'merchant_wallet_funding',
          request_id: 'r',
          merchant_id: 'm',
        },
      },
    };
    const response = await POST(
      createMockRequest(body, { 'x-paystack-signature': 'invalid-signature' })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Invalid signature' });
    expect(mockFailMerchantWalletAssignmentEvent).not.toHaveBeenCalled();
  });

  it('returns review for a signed uncorrelated assignment failure', async () => {
    mockFailMerchantWalletAssignmentEvent.mockResolvedValue({
      kind: 'review',
    });
    const body = {
      event: 'dedicatedaccount.assign.failed',
      data: { metadata: { source: 'merchant_wallet_funding' } },
    };
    const response = await POST(
      createMockRequest(body, {
        'x-paystack-signature': createSignature(
          JSON.stringify(body),
          'test-paystack-secret'
        ),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      handled: 'merchant_wallet_assignment_failure_review',
      code: 'MERCHANT_WALLET_ASSIGNMENT_FAILURE_REVIEW',
    });
  });

  it('returns review for a signed assignment conflict without entering charge flow', async () => {
    mockPersistMerchantWalletAssignmentEvent.mockResolvedValue({
      kind: 'review',
    });
    const body = {
      event: 'dedicatedaccount.assign.success',
      data: {
        metadata: {
          source: 'merchant_wallet_funding',
          request_id: 'r',
          merchant_id: 'm',
        },
        dedicated_account: { account_number: '1234567890', currency: 'NGN' },
      },
    };
    const response = await POST(
      createMockRequest(body, {
        'x-paystack-signature': createSignature(
          JSON.stringify(body),
          'test-paystack-secret'
        ),
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      handled: 'merchant_wallet_assignment_review',
      code: 'MERCHANT_WALLET_ASSIGNMENT_REVIEW',
    });
  });

  it('acknowledges a signed assignment with unrelated metadata source', async () => {
    mockPersistMerchantWalletAssignmentEvent.mockResolvedValue({
      kind: 'ignored',
    });
    const body = {
      event: 'dedicatedaccount.assign.success',
      data: {
        metadata: {
          source: 'order_dva',
          request_id: 'r',
          merchant_id: 'm',
        },
        dedicated_account: { account_number: '1234567890', currency: 'NGN' },
      },
    };
    const response = await POST(
      createMockRequest(body, {
        'x-paystack-signature': createSignature(
          JSON.stringify(body),
          'test-paystack-secret'
        ),
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: 'Event ignored' });
  });
});

describe('GET /api/payments/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock clients
    mockServiceClient = createMockSupabaseClient();
    mockSupabaseClient = createMockSupabaseClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      });

      const url =
        'https://example.com/api/payments/webhook?reference=REF123&gateway=korapay';
      const request = {
        url,
      } as NextRequest;

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: 'Unauthorized' });
    });
  });

  describe('Reference Validation', () => {
    it('returns 400 when reference is invalid', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const url =
        'https://example.com/api/payments/webhook?reference=&gateway=korapay';
      const request = {
        url,
      } as NextRequest;

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Invalid reference' });
    });

    it('returns 400 when reference is missing', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      const url = 'https://example.com/api/payments/webhook?gateway=korapay';
      const request = {
        url,
      } as NextRequest;

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Invalid reference' });
    });
  });

  describe('Merchant Authorization', () => {
    it('returns 403 when merchant account is not found', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      mockSupabaseClient.from().single.mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      });

      const url =
        'https://example.com/api/payments/webhook?reference=REF123&gateway=korapay';
      const request = {
        url,
      } as NextRequest;

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data).toEqual({ error: 'Merchant account not found' });
    });
  });

  describe('Transaction Lookup', () => {
    it('returns 404 when transaction is not found', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'merchants') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'merchant-123' },
              error: null,
            }),
          };
        }
        // transactions - not found
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Not found' },
          }),
        };
      });

      const url =
        'https://example.com/api/payments/webhook?reference=REF123&gateway=korapay';
      const request = {
        url,
      } as NextRequest;

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({ error: 'Transaction not found' });
    });

    it('returns 404 when transaction belongs to different merchant (IDOR protection)', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'merchants') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'merchant-123' },
              error: null,
            }),
          };
        }
        // transactions - not found (merchant_id doesn't match)
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Not found' },
          }),
        };
      });

      const url =
        'https://example.com/api/payments/webhook?reference=REF123&gateway=korapay';
      const request = {
        url,
      } as NextRequest;

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({ error: 'Transaction not found' });
    });
  });

  describe('Success Path', () => {
    it('returns payment data when transaction is found and verified', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'merchants') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'merchant-123' },
              error: null,
            }),
          };
        }
        // transactions - found
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'txn-123',
              merchant_id: 'merchant-123',
            },
            error: null,
          }),
        };
      });

      // Mock Korapay verification
      const { verifyPayment } = await import('@/lib/korapay');
      vi.mocked(verifyPayment).mockResolvedValue({
        success: true,
        data: {
          status: 'success',
          amount: 1000,
          reference: 'REF123',
          currency: 'NGN',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: { name: 'Test', email: 'test@example.com' },
        },
      });

      const url =
        'https://example.com/api/payments/webhook?reference=REF123&gateway=korapay';
      const request = {
        url,
      } as NextRequest;

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toMatchObject({
        success: true,
        gateway: 'korapay',
        payment: {
          success: true,
          data: { status: 'success', amount: 1000 },
        },
      });
    });

    it('defaults to paystack gateway when gateway param is invalid', async () => {
      mockSupabaseClient.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'merchants') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'merchant-123' },
              error: null,
            }),
          };
        }
        // transactions - found
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'txn-123',
              merchant_id: 'merchant-123',
            },
            error: null,
          }),
        };
      });

      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          id: 1,
          status: 'success',
          amount: 100000,
          reference: 'REF123',
          currency: 'NGN',
          channel: 'card',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: {
            id: 1,
            email: 'test@example.com',
            customer_code: 'CUS_test',
            first_name: null,
            last_name: null,
            phone: null,
          },
          metadata: null,
          fees: 150,
          fees_split: null,
        },
      });

      const url =
        'https://example.com/api/payments/webhook?reference=REF123&gateway=invalid';
      const request = {
        url,
      } as NextRequest;

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.gateway).toBe('paystack');
    });
  });

  describe('VTU fulfillment', () => {
    it('fulfills paid VTU transactions from webhook metadata', async () => {
      const { verifyTransaction } = await import('@/lib/paystack');
      vi.mocked(verifyTransaction).mockResolvedValue({
        success: true,
        data: {
          id: 1,
          status: 'success',
          amount: 100000,
          reference: 'REF123',
          currency: 'NGN',
          channel: 'card',
          paid_at: '2026-01-01T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
          customer: {
            id: 1,
            email: 'customer@example.com',
            customer_code: 'CUS_test',
            first_name: null,
            last_name: null,
            phone: null,
          },
          metadata: null,
          authorization: {
            authorization_code: 'AUTH_123',
            card_type: 'visa DEBIT',
            last4: '1234',
            exp_month: '08',
            exp_year: '2030',
            bank: 'Access Bank',
            channel: 'card',
            signature: 'SIG_123',
            reusable: true,
            country_code: 'NG',
          },
          fees: 150,
          fees_split: null,
        },
      });

      setupSuccessfulTransactionMocks({
        metadata: {
          transaction_type: 'vtu_purchase',
          vtu_transaction_id: 'vtu-1',
          customer_id: 'customer-1',
          customer_email: 'customer@example.com',
        },
      });

      const body = {
        event: 'charge.success',
        data: {
          reference: 'REF123',
        },
      };
      const bodyString = JSON.stringify(body);
      const signature = createSignature(bodyString, 'test-paystack-secret');
      const request = createMockRequest(body, {
        'x-paystack-signature': signature,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ message: 'VTU payment fulfilled' });
    });
  });
});
