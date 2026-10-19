import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAfterCallbacks } = vi.hoisted(() => ({
  mockAfterCallbacks: [] as Array<() => unknown | Promise<unknown>>,
}));

const mockAuthenticateApiRequest = vi.fn();
const mockVerifyPaystackTransaction = vi.fn();
const mockUpsertPaystackAuthorization = vi.fn();
const mockFulfillPendingVtuTransaction = vi.fn();
const mockResolveVtuCustomer = vi.fn();
const mockScheduleVoucherPinBackfill = vi.fn();
const mockFrom = vi.fn();

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<ServerModule>();

  return {
    ...actual,
    after: (callback: () => unknown | Promise<unknown>) => {
      mockAfterCallbacks.push(callback);
    },
  };
});

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(() =>
    Promise.resolve({ valid: true, response: null })
  ),
}));

vi.mock('@/lib/paystack', async (importOriginal) => {
  const actual = await importOriginal<PaystackModule>();

  return {
    ...actual,
    verifyTransaction: (...args: unknown[]) =>
      mockVerifyPaystackTransaction(...args),
  };
});

vi.mock('@/lib/korapay', () => ({
  verifyPayment: vi.fn(),
}));

vi.mock('@/lib/customer-saved-payment-methods', () => ({
  upsertPaystackAuthorization: (...args: unknown[]) =>
    mockUpsertPaystackAuthorization(...args),
}));

vi.mock('@/lib/vtu-fulfillment', () => ({
  fulfillPendingVtuTransaction: (...args: unknown[]) =>
    mockFulfillPendingVtuTransaction(...args),
}));

vi.mock('@/lib/vtu-pending-transaction', () => ({
  resolveVtuCustomer: (...args: unknown[]) => mockResolveVtuCustomer(...args),
}));

vi.mock('@/lib/vtu-voucher-backfill', () => ({
  extractMetadataField: <T>(
    metadata: unknown,
    key: string,
    validator: (value: unknown) => value is T
  ) =>
    typeof metadata === 'object' &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    validator((metadata as Record<string, unknown>)[key])
      ? (metadata as Record<string, unknown>)[key]
      : null,
  isString: (value: unknown): value is string => typeof value === 'string',
  normalizeMetadata: (metadata: unknown) =>
    typeof metadata === 'object' &&
    metadata !== null &&
    !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {},
  scheduleVoucherPinBackfill: (...args: unknown[]) =>
    mockScheduleVoucherPinBackfill(...args),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

import { POST } from './route';

type ServerModule = typeof import('next/server');
type PaystackModule = typeof import('@/lib/paystack');

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/vtu/checkout/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const defaultPaymentTransaction = {
  id: 'txn-1',
  amount: 1000,
  currency: 'NGN',
  status: 'pending',
  merchant_id: 'merchant-1',
  metadata: {
    transaction_type: 'vtu_purchase',
    vtu_transaction_id: 'vtu-1',
    customer_id: 'customer-1',
    customer_email: 'customer@example.com',
  },
};

type PaymentTransaction = typeof defaultPaymentTransaction;
type PaymentUpdateResult = {
  data: Pick<PaymentTransaction, 'id'> | null;
  error: unknown;
};

const defaultVtuTransaction = {
  id: 'vtu-1',
  created_at: '2026-06-02T00:00:00.000Z',
  type: 'electricity',
  status: 'successful',
  amount: 1000,
  network_provider: '',
  phone_number: '',
  biller_name: 'EKEDC PREPAID',
  biller_item_code: 'KUD-ELE-EKED-002',
  customer_identifier: '43901766923',
  customer_name: null,
  request_reference: 'VTU-123',
  transaction_id: 'kuda-1',
  error_message: null,
  customer_cashback: 0,
  metadata: {},
};

function createMockFrom({
  transactionError = null,
  transactionData = defaultPaymentTransaction,
  updateResult = { data: { id: 'txn-1' }, error: null },
  vtuTransactionData = defaultVtuTransaction,
  vtuTransactionError = null,
}: {
  transactionError?: unknown;
  transactionData?: PaymentTransaction | null;
  updateResult?: PaymentUpdateResult;
  vtuTransactionData?: typeof defaultVtuTransaction | null;
  vtuTransactionError?: unknown;
} = {}) {
  return (table: string) => {
    if (table === 'merchants') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'merchant-1' },
              error: null,
            }),
          }),
        }),
      };
    }

    if (table === 'transactions') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: transactionData,
              error: transactionError,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            neq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue(updateResult),
              }),
            }),
          }),
        }),
      };
    }

    if (table === 'vtu_transactions') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: vtuTransactionData,
              error: vtuTransactionError,
            }),
          }),
        }),
      };
    }

    throw new Error(`Unexpected table in checkout confirm test: ${table}`);
  };
}

describe('POST /api/vtu/checkout/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAfterCallbacks.length = 0;
    mockAuthenticateApiRequest.mockResolvedValue({
      user: { id: 'user-1', email: 'customer@example.com' },
      error: null,
      supabase: {},
    });
    mockVerifyPaystackTransaction.mockResolvedValue({
      success: true,
      data: {
        amount: 100000,
        status: 'success',
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
      },
    });
    mockFulfillPendingVtuTransaction.mockResolvedValue({
      status: 'successful',
      amount: 1000,
      loyaltyPoints: {
        credited: true,
        earned: 5,
        newBalance: 205,
      },
      reference: 'VTU-123',
    });
    mockScheduleVoucherPinBackfill.mockResolvedValue(true);
    mockResolveVtuCustomer.mockResolvedValue({ id: 'customer-1' });
    mockFrom.mockImplementation(createMockFrom());
  });

  it('returns 404 when the payment transaction does not exist', async () => {
    mockFrom.mockImplementation(createMockFrom({ transactionData: null }));

    const response = await POST(
      makeRequest({
        merchantSlug: 'ogabassey',
        gateway: 'paystack',
        reference: 'VTU-123',
      })
    );

    expect(response.status).toBe(404);
  });

  it('confirms payment, stores the reusable card, and fulfills VTU', async () => {
    const response = await POST(
      makeRequest({
        merchantSlug: 'ogabassey',
        gateway: 'paystack',
        reference: 'VTU-123',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      success: true,
      status: 'successful',
      reference: 'VTU-123',
      amount: 1000,
      loyaltyPoints: {
        credited: true,
        earned: 5,
        newBalance: 205,
      },
    });
    expect(mockUpsertPaystackAuthorization).toHaveBeenCalled();
    expect(mockFulfillPendingVtuTransaction).toHaveBeenCalledWith({
      retryFailed: true,
      supabase: expect.any(Object),
      transactionId: 'vtu-1',
    });
  });

  it('schedules token backfill for successful token-backed purchases without an immediate voucher pin', async () => {
    mockFulfillPendingVtuTransaction.mockResolvedValue({
      status: 'successful',
      amount: 1000,
      reference: 'VTU-123',
    });

    const response = await POST(
      makeRequest({
        merchantSlug: 'ogabassey',
        gateway: 'paystack',
        reference: 'VTU-123',
      })
    );

    expect(response.status).toBe(200);
    expect(mockAfterCallbacks).toHaveLength(1);

    await mockAfterCallbacks[0]?.();

    expect(mockScheduleVoucherPinBackfill).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {},
        originalMetadata: {},
        transaction: expect.objectContaining({
          id: 'vtu-1',
          status: 'successful',
          type: 'electricity',
        }),
        voucherPin: null,
      })
    );
  });

  it('schedules one voucher backfill for processing fulfillment', async () => {
    mockFrom.mockImplementation(
      createMockFrom({
        vtuTransactionData: {
          ...defaultVtuTransaction,
          status: 'processing',
        },
      })
    );
    mockFulfillPendingVtuTransaction.mockResolvedValue({
      status: 'processing',
      reference: 'VTU-123',
    });

    const response = await POST(
      makeRequest({
        merchantSlug: 'ogabassey',
        gateway: 'paystack',
        reference: 'VTU-123',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(202);
    expect(data).toEqual({ reference: 'VTU-123', status: 'processing' });
    expect(mockAfterCallbacks).toHaveLength(1);

    await mockAfterCallbacks[0]?.();

    expect(mockScheduleVoucherPinBackfill).toHaveBeenCalledTimes(1);
    expect(mockScheduleVoucherPinBackfill).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {},
        originalMetadata: {},
        transaction: expect.objectContaining({
          id: 'vtu-1',
          status: 'processing',
          type: 'electricity',
        }),
        voucherPin: null,
      })
    );
  });

  // Phase B.7 regression-pin: when initialize records a hybrid
  // payment, `transactions.amount` holds the residual (post-wallet)
  // and the gateway returned the same residual. Confirm's
  // amount-comparison guard MUST accept this. If a future change
  // stored the full bill amount on `transactions` while charging
  // the gateway a smaller residual, this test would fail with 400
  // "Payment amount mismatch".
  it('accepts hybrid residual: transaction.amount === gateway-verified residual', async () => {
    mockFrom.mockImplementation(
      createMockFrom({
        transactionData: {
          ...defaultPaymentTransaction,
          amount: 600,
        },
      })
    );
    mockVerifyPaystackTransaction.mockResolvedValue({
      success: true,
      data: {
        amount: 60000, // 600 NGN in kobo — the residual the gateway charged
        status: 'success',
      },
    });

    const response = await POST(
      makeRequest({
        merchantSlug: 'ogabassey',
        gateway: 'paystack',
        reference: 'VTU-123',
      })
    );

    expect(response.status).toBe(200);
    expect(mockFulfillPendingVtuTransaction).toHaveBeenCalled();
  });

  it('accepts Paystack bank-transfer payments when amount includes customer-borne fees', async () => {
    mockFrom.mockImplementation(
      createMockFrom({
        transactionData: {
          ...defaultPaymentTransaction,
          amount: 3000,
        },
      })
    );
    mockVerifyPaystackTransaction.mockResolvedValue({
      success: true,
      data: {
        amount: 314_721,
        requested_amount: 300_000,
        fees: 14_721,
        status: 'success',
      },
    });

    const response = await POST(
      makeRequest({
        merchantSlug: 'ogabassey',
        gateway: 'paystack',
        reference: 'VTU-123',
      })
    );

    expect(response.status).toBe(200);
    expect(mockFulfillPendingVtuTransaction).toHaveBeenCalledWith({
      retryFailed: true,
      supabase: expect.any(Object),
      transactionId: 'vtu-1',
    });
  });

  it('rejects gateway confirmations when the verified amount is malformed', async () => {
    mockVerifyPaystackTransaction.mockResolvedValue({
      success: true,
      data: {
        amount: 100_000.5,
        status: 'success',
      },
    });

    const response = await POST(
      makeRequest({
        merchantSlug: 'ogabassey',
        gateway: 'paystack',
        reference: 'VTU-123',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({ error: 'Payment amount could not be verified' });
    expect(mockFulfillPendingVtuTransaction).not.toHaveBeenCalled();
  });

  it('continues to VTU fulfillment when another process already claimed the payment', async () => {
    mockFrom.mockImplementation(
      createMockFrom({ updateResult: { data: null, error: null } })
    );

    const response = await POST(
      makeRequest({
        merchantSlug: 'ogabassey',
        gateway: 'paystack',
        reference: 'VTU-123',
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      success: true,
      status: 'successful',
      reference: 'VTU-123',
      amount: 1000,
    });
    expect(mockFulfillPendingVtuTransaction).toHaveBeenCalledWith({
      retryFailed: true,
      supabase: expect.any(Object),
      transactionId: 'vtu-1',
    });
  });
});
