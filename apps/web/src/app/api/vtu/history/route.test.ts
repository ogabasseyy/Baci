import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
}));

const mockAuthenticateApiRequest = vi.fn();
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
}));

const mockGetCurrentSlugForAlias = vi.fn();
const mockGetCurrentSlugForAliasStrict = vi.fn();
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: (...args: unknown[]) =>
    mockGetCurrentSlugForAlias(...args),
  getCurrentSlugForAliasStrict: (...args: unknown[]) =>
    mockGetCurrentSlugForAliasStrict(...args),
}));

const mockAfter = vi.fn();
vi.mock('next/server', async () => {
  const actual =
    await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: (callback: () => unknown) => mockAfter(callback),
  };
});

const mockBackfillVtuVoucherPin = vi.fn();
const mockFulfillPendingVtuTransaction = vi.fn();
vi.mock('@/lib/vtu-fulfillment', () => ({
  backfillVtuVoucherPin: (...args: unknown[]) =>
    mockBackfillVtuVoucherPin(...args),
  fulfillPendingVtuTransaction: (...args: unknown[]) =>
    mockFulfillPendingVtuTransaction(...args),
}));

let merchantData: { id: string } | null = null;
let merchantError: unknown = null;
let merchantDataBySlug: Record<string, { id: string } | null> = {};
let customerByUserIdData: { id: string; user_id: string | null } | null = null;
let customerByEmailData: { id: string; user_id: string | null } | null = null;
let customerLookupError: unknown = null;
let transactionsData: Record<string, unknown>[] | null = null;
let transactionsError: unknown = null;
let paymentRowsData: Record<string, unknown>[] | null = null;
let paymentRowsError: unknown = null;
let transactionEqCalls: [string, unknown][] = [];
let vtuTransactionUpdateEqCalls: [string, unknown][] = [];
let vtuTransactionUpdateFilters: [string, string, unknown][] = [];
let vtuTransactionUpdateIsCalls: [string, unknown][] = [];
let vtuTransactionUpdatePayloads: Record<string, unknown>[] = [];
let vtuTransactionUpdateRows: Record<string, unknown>[] | null = null;
let vtuTransactionUpdateError: unknown = null;
let vtuTransactionUpdateSelectPromise: Promise<{
  data: Record<string, unknown>[] | null;
  error: unknown;
}> | null = null;
const mockCustomerUpdateEq = vi.fn();

function createMockSupabase() {
  const customerSelect = vi.fn(() => {
    const filters = new Map<string, unknown>();
    const builder = {
      eq: vi.fn((field: string, value: unknown) => {
        filters.set(field, value);
        return builder;
      }),
      maybeSingle: vi.fn().mockImplementation(() => {
        if (filters.has('user_id')) {
          return { data: customerByUserIdData, error: customerLookupError };
        }

        if (filters.has('email')) {
          return { data: customerByEmailData, error: customerLookupError };
        }

        return { data: null, error: null };
      }),
    };
    return builder;
  });

  const transactionQuery = {
    eq: vi.fn((field: string, value: unknown) => {
      transactionEqCalls.push([field, value]);
      return transactionQuery;
    }),
    order: vi.fn(() => transactionQuery),
    limit: vi.fn().mockResolvedValue({
      data: transactionsData,
      error: transactionsError,
    }),
  };

  const createVtuTransactionUpdateQuery = () => {
    const builder = {
      eq: vi.fn((field: string, value: unknown) => {
        vtuTransactionUpdateEqCalls.push([field, value]);
        return builder;
      }),
      filter: vi.fn((field: string, operator: string, value: unknown) => {
        vtuTransactionUpdateFilters.push([field, operator, value]);
        return builder;
      }),
      is: vi.fn((field: string, value: unknown) => {
        vtuTransactionUpdateIsCalls.push([field, value]);
        return builder;
      }),
      select: vi.fn(() =>
        vtuTransactionUpdateSelectPromise
          ? vtuTransactionUpdateSelectPromise
          : Promise.resolve({
              data: vtuTransactionUpdateRows,
              error: vtuTransactionUpdateError,
            })
      ),
    };
    return builder;
  };

  const paymentStatusQuery = {
    eq: vi.fn(() => paymentStatusQuery),
    in: vi.fn().mockResolvedValue({
      data: paymentRowsData,
      error: paymentRowsError,
    }),
  };

  return {
    from: vi.fn((table: string) => {
      if (table === 'merchants') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((field: string, value: unknown) => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data:
                  field === 'slug' &&
                  typeof value === 'string' &&
                  value in merchantDataBySlug
                    ? merchantDataBySlug[value]
                    : merchantData,
                error: merchantError,
              }),
            })),
          })),
        };
      }

      if (table === 'customers') {
        return {
          select: customerSelect,
          update: vi.fn(() => ({
            eq: mockCustomerUpdateEq,
          })),
        };
      }

      if (table === 'vtu_transactions') {
        return {
          select: vi.fn(() => transactionQuery),
          update: vi.fn((payload: Record<string, unknown>) => {
            vtuTransactionUpdatePayloads.push(payload);
            return createVtuTransactionUpdateQuery();
          }),
        };
      }

      if (table === 'transactions') {
        return {
          select: vi.fn(() => paymentStatusQuery),
        };
      }

      return {
        select: vi.fn(),
      };
    }),
  };
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => createMockSupabase()),
}));

function makeRequest(search = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/vtu/history${search}`);
}

describe('GET /api/vtu/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAfter.mockReset();
    mockBackfillVtuVoucherPin.mockReset();
    mockFulfillPendingVtuTransaction.mockReset();
    merchantData = { id: 'merchant-1' };
    merchantError = null;
    merchantDataBySlug = {};
    mockGetCurrentSlugForAlias.mockReset();
    mockGetCurrentSlugForAlias.mockResolvedValue(null);
    mockGetCurrentSlugForAliasStrict.mockReset();
    mockGetCurrentSlugForAliasStrict.mockResolvedValue(null);
    customerByUserIdData = { id: 'customer-1', user_id: 'user-1' };
    customerByEmailData = null;
    customerLookupError = null;
    transactionsData = [
      {
        id: 'tx-1',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-1',
        type: 'electricity',
        status: 'successful',
        amount: '2500',
        biller_name: 'EKEDC NG',
        metadata: {
          dataPlanCode: 'KUD-DATA-001',
          gateway: 'paystack',
          paymentReference: 'VTU-PAYSTACK-123',
          voucherPin: '1234-5678',
          units: '4.5',
        },
        request_reference: 'VTU-123',
        customer_cashback: '0',
      },
    ];
    transactionsError = null;
    paymentRowsData = [
      {
        gateway: 'paystack',
        gateway_reference: 'VTU-PAYSTACK-123',
        status: 'completed',
      },
    ];
    paymentRowsError = null;
    transactionEqCalls = [];
    vtuTransactionUpdateEqCalls = [];
    vtuTransactionUpdateFilters = [];
    vtuTransactionUpdateIsCalls = [];
    vtuTransactionUpdatePayloads = [];
    vtuTransactionUpdateRows = [{ id: 'tx-1' }];
    vtuTransactionUpdateError = null;
    vtuTransactionUpdateSelectPromise = null;
    mockCustomerUpdateEq.mockResolvedValue({ data: null, error: null });
    mockAuthenticateApiRequest.mockResolvedValue({
      // Verified session: the history email fallback requires a
      // confirmed address (Muse R119), mirroring production logins.
      user: {
        id: 'user-1',
        email: 'customer@example.com',
        email_confirmed_at: '2026-01-01T00:00:00.000Z',
      },
      error: null,
      supabase: {},
    });
  });

  it('returns 401 when the request is not authenticated', async () => {
    const { GET } = await import('./route');
    mockAuthenticateApiRequest.mockResolvedValue({
      user: null,
      error: 'Unauthorized',
      supabase: null,
    });

    const response = await GET(makeRequest('?merchantSlug=ogabassey'));
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
  });

  it('returns 400 when the query is invalid', async () => {
    const { GET } = await import('./route');

    const response = await GET(
      makeRequest('?merchantSlug=ogabassey&type=invalid')
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid query');
    expect(data.details.fieldErrors.type).toBeDefined();
  });

  it('returns transactions for the resolved customer and applies the type filter', async () => {
    const { GET } = await import('./route');
    customerByUserIdData = null;
    // Email fallback accepts ONLY a row already linked to this auth
    // user (user-1). An unlinked or mismatched match previously
    // disclosed the row's history + voucher PINs to whoever held an
    // account with that email (tenant isolation); those now fall
    // through to the empty list (see the two tests below).
    customerByEmailData = { id: 'customer-1', user_id: 'user-1' };
    mockCustomerUpdateEq.mockImplementation(() => {
      throw new Error('GET /vtu/history must not relink customers');
    });

    const response = await GET(
      makeRequest('?merchantSlug=ogabassey&type=electricity&limit=5')
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.transactions).toEqual([
      expect.objectContaining({
        id: 'tx-1',
        amount: 2500,
        customer_cashback: 0,
        payment_gateway: 'paystack',
        payment_reference: 'VTU-PAYSTACK-123',
        payment_status: 'completed',
        repeat_data_plan_code: 'KUD-DATA-001',
        voucher_pin: '1234-5678',
        units: '4.5',
      }),
    ]);
    expect(transactionEqCalls).toContainEqual(['merchant_id', 'merchant-1']);
    expect(transactionEqCalls).toContainEqual(['customer_id', 'customer-1']);
    expect(transactionEqCalls).toContainEqual(['type', 'electricity']);
  });

  it('returns no history when the email-matched customer belongs to a different user', async () => {
    // Tenant isolation: the email claim alone must not disclose
    // another customer's transactions or voucher PINs.
    const { GET } = await import('./route');
    customerByUserIdData = null;
    customerByEmailData = { id: 'customer-1', user_id: 'user-2' };

    const response = await GET(makeRequest('?merchantSlug=ogabassey'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.transactions).toEqual([]);
    expect(transactionEqCalls).toEqual([]);
  });

  it('returns no history when the email-matched customer is unlinked', async () => {
    // Same guard for guest (user_id null) rows: accepting them would
    // disclose a stranger's history to whoever registers the email,
    // and linking-on-read would let them claim it permanently. GET
    // stays read-only; checkout links on the next purchase.
    const { GET } = await import('./route');
    customerByUserIdData = null;
    customerByEmailData = { id: 'customer-1', user_id: null };

    const response = await GET(makeRequest('?merchantSlug=ogabassey'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.transactions).toEqual([]);
    expect(transactionEqCalls).toEqual([]);
  });

  it('scopes by exact reference when the backfill passes one', async () => {
    const { GET } = await import('./route');

    const response = await GET(
      makeRequest(
        '?merchantSlug=ogabassey&type=electricity&limit=20&reference=VTU-123'
      )
    );

    expect(response.status).toBe(200);
    expect(transactionEqCalls).toContainEqual(['merchant_id', 'merchant-1']);
    expect(transactionEqCalls).toContainEqual(['customer_id', 'customer-1']);
    expect(transactionEqCalls).toContainEqual(['request_reference', 'VTU-123']);
  });

  it('logs and falls back when a transaction amount is not finite', async () => {
    const { GET } = await import('./route');
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    transactionsData = [
      {
        id: 'tx-invalid-amount',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-1',
        type: 'airtime',
        status: 'successful',
        amount: 'not-a-number',
        biller_name: 'MTN',
        metadata: {},
        request_reference: 'VTU-INVALID-AMOUNT',
        transaction_id: null,
        customer_cashback: '0',
      },
    ];

    try {
      const response = await GET(makeRequest('?merchantSlug=ogabassey'));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.transactions).toEqual([
        expect.objectContaining({
          amount: 0,
          id: 'tx-invalid-amount',
        }),
      ]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Invalid VTU transaction amount in history response:',
        expect.objectContaining({
          amount: 'not-a-number',
          transactionId: 'tx-invalid-amount',
        })
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('logs and falls back when customer cashback is not finite', async () => {
    const { GET } = await import('./route');
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    transactionsData = [
      {
        id: 'tx-invalid-cashback',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-1',
        type: 'airtime',
        status: 'successful',
        amount: '2500',
        biller_name: 'MTN',
        metadata: {},
        request_reference: 'VTU-INVALID-CASHBACK',
        transaction_id: null,
        customer_cashback: 'not-a-number',
      },
    ];

    try {
      const response = await GET(makeRequest('?merchantSlug=ogabassey'));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.transactions).toEqual([
        expect.objectContaining({
          customer_cashback: 0,
          id: 'tx-invalid-cashback',
        }),
      ]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Invalid VTU customer cashback amount in history response:',
        expect.objectContaining({
          customerCashback: 'not-a-number',
          transactionId: 'tx-invalid-cashback',
        })
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('returns history immediately and schedules missing voucher-pin backfill after response', async () => {
    const { GET } = await import('./route');
    transactionsData = [
      {
        id: 'tx-1',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-1',
        type: 'electricity',
        status: 'successful',
        amount: '2500',
        biller_name: 'EKEDC NG',
        metadata: {
          alpha: 'first',
          zeta: 'last',
        },
        request_reference: 'VTU-123',
        transaction_id: 'kuda-bill-1',
        customer_cashback: '0',
      },
    ];
    paymentRowsData = [];
    mockBackfillVtuVoucherPin.mockResolvedValue('1234-5678');

    const response = await GET(
      makeRequest('?merchantSlug=ogabassey&type=electricity')
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.transactions).toEqual([
      expect.objectContaining({
        id: 'tx-1',
        voucher_pin: null,
      }),
    ]);
    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(vtuTransactionUpdatePayloads).toEqual([]);
    expect(mockBackfillVtuVoucherPin).not.toHaveBeenCalled();

    const scheduledBackfillClaim = mockAfter.mock.calls[0]?.[0] as
      | (() => Promise<void>)
      | undefined;
    expect(scheduledBackfillClaim).toBeDefined();
    if (!scheduledBackfillClaim) {
      throw new Error('Expected voucher-pin backfill claim to be scheduled');
    }

    await scheduledBackfillClaim();

    expect(vtuTransactionUpdatePayloads).toEqual([
      {
        metadata: expect.objectContaining({
          voucherPinBackfillScheduledAt: expect.any(String),
        }),
      },
    ]);
    expect(vtuTransactionUpdateEqCalls).toContainEqual(['id', 'tx-1']);
    const metadataFilter = vtuTransactionUpdateFilters.find(
      ([field, operator]) => field === 'metadata' && operator === 'eq'
    );
    expect(metadataFilter).toBeDefined();
    expect(JSON.parse(String(metadataFilter?.[2]))).toEqual({
      alpha: 'first',
      zeta: 'last',
    });
    expect(mockBackfillVtuVoucherPin).not.toHaveBeenCalled();

    expect(mockAfter).toHaveBeenCalledTimes(2);
    const scheduledBackfill = mockAfter.mock.calls[1]?.[0] as
      | (() => Promise<void>)
      | undefined;
    expect(scheduledBackfill).toBeDefined();
    if (!scheduledBackfill) {
      throw new Error('Expected voucher-pin backfill to be scheduled');
    }
    await scheduledBackfill();

    expect(mockBackfillVtuVoucherPin).toHaveBeenCalledWith({
      billRequestRef: 'VTU-123',
      billResponseReference: 'kuda-bill-1',
      metadata: expect.objectContaining({
        voucherPinBackfillScheduledAt: expect.any(String),
      }),
      supabase: expect.any(Object),
      transactionId: 'tx-1',
    });
  });

  it('does not let reference-less rows starve eligible rows of backfill budget', async () => {
    // Three reference-less processing rows sit ahead of an eligible
    // row. They would be rejected downstream anyway; if they consumed
    // the 3-slot MAX_TOKEN_BACKFILL_SCHEDULES budget first, the
    // eligible row would never be scheduled (Codex R43 rnTRj).
    const { GET } = await import('./route');
    const referenceLess = (id: string) => ({
      amount: '2500',
      biller_name: 'EKEDC NG',
      created_at: '2026-04-08T12:00:00.000Z',
      customer_id: 'customer-1',
      customer_cashback: '0',
      error_message: null,
      id,
      metadata: {},
      request_reference: `VTU-${id}`,
      status: 'processing',
      transaction_id: null,
      type: 'electricity',
    });
    transactionsData = [
      referenceLess('tx-ref-1'),
      referenceLess('tx-ref-2'),
      referenceLess('tx-ref-3'),
      {
        amount: '2500',
        biller_name: 'EKEDC NG',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-1',
        customer_cashback: '0',
        id: 'tx-eligible',
        metadata: {},
        request_reference: 'VTU-eligible',
        status: 'successful',
        transaction_id: 'kuda-bill-eligible',
        type: 'electricity',
      },
    ];
    paymentRowsData = [];
    mockBackfillVtuVoucherPin.mockResolvedValue('1234-5678');

    const response = await GET(
      makeRequest('?merchantSlug=ogabassey&type=electricity')
    );
    expect(response.status).toBe(200);
    expect(mockAfter).toHaveBeenCalledTimes(1);

    const scheduledBackfillClaim = mockAfter.mock.calls[0]?.[0] as
      | (() => Promise<void>)
      | undefined;
    expect(scheduledBackfillClaim).toBeDefined();
    if (!scheduledBackfillClaim) {
      throw new Error('Expected voucher-pin backfill claim to be scheduled');
    }
    await scheduledBackfillClaim();

    expect(vtuTransactionUpdateEqCalls).toContainEqual(['id', 'tx-eligible']);
    expect(vtuTransactionUpdatePayloads).toEqual([
      {
        metadata: expect.objectContaining({
          voucherPinBackfillScheduledAt: expect.any(String),
        }),
      },
    ]);
  });

  it('schedules processing bill reconciliation from history polling', async () => {
    const { GET } = await import('./route');
    transactionsData = [
      {
        id: 'tx-processing',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-1',
        type: 'electricity',
        status: 'processing',
        amount: '1000',
        biller_name: 'EKEDC NG',
        metadata: {
          paymentReference: 'VTU-PAYSTACK-123',
        },
        request_reference: 'VTU-REQ-123',
        transaction_id: 'kuda-bill-1',
        customer_cashback: '0',
      },
    ];
    paymentRowsData = [];
    mockFulfillPendingVtuTransaction.mockResolvedValue({
      amount: 1000,
      reference: 'VTU-REQ-123',
      status: 'processing',
    });

    const response = await GET(
      makeRequest('?merchantSlug=ogabassey&type=electricity')
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.transactions).toEqual([
      expect.objectContaining({
        id: 'tx-processing',
        status: 'processing',
        voucher_pin: null,
      }),
    ]);
    expect(mockAfter).toHaveBeenCalledTimes(1);

    const scheduledBackfillClaim = mockAfter.mock.calls[0]?.[0] as
      | (() => Promise<void>)
      | undefined;
    expect(scheduledBackfillClaim).toBeDefined();
    if (!scheduledBackfillClaim) {
      throw new Error(
        'Expected processing reconciliation claim to be scheduled'
      );
    }
    await scheduledBackfillClaim();

    expect(vtuTransactionUpdatePayloads).toEqual([
      {
        metadata: expect.objectContaining({
          voucherPinBackfillScheduledAt: expect.any(String),
        }),
      },
    ]);
    expect(vtuTransactionUpdatePayloads[0].metadata).not.toHaveProperty(
      'voucherPinBackfillAttempts'
    );
    expect(mockAfter).toHaveBeenCalledTimes(2);

    const scheduledReconciliation = mockAfter.mock.calls[1]?.[0] as
      | (() => Promise<void>)
      | undefined;
    expect(scheduledReconciliation).toBeDefined();
    if (!scheduledReconciliation) {
      throw new Error('Expected processing reconciliation to be scheduled');
    }
    await scheduledReconciliation();

    expect(mockFulfillPendingVtuTransaction).toHaveBeenCalledWith({
      supabase: expect.any(Object),
      transactionId: 'tx-processing',
    });
    expect(mockBackfillVtuVoucherPin).not.toHaveBeenCalled();
  });

  it('never schedules fulfillment for rows outside the resolved caller', async () => {
    // Muse R138: fulfillment-level ownership assertion, not just
    // the query filter — a foreign row reaching the scheduler
    // (future query refactor) must not be fulfilled.
    const { GET } = await import('./route');
    transactionsData = [
      {
        id: 'tx-owned',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-1',
        type: 'electricity',
        status: 'processing',
        amount: '1000',
        biller_name: 'EKEDC NG',
        metadata: {},
        request_reference: 'VTU-OWNED',
        transaction_id: 'kuda-bill-owned',
        customer_cashback: '0',
      },
      {
        id: 'tx-foreign',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-2',
        type: 'electricity',
        status: 'processing',
        amount: '1000',
        biller_name: 'EKEDC NG',
        metadata: {},
        request_reference: 'VTU-FOREIGN',
        transaction_id: 'kuda-bill-foreign',
        customer_cashback: '0',
      },
    ];
    paymentRowsData = [];
    mockFulfillPendingVtuTransaction.mockResolvedValue({
      amount: 1000,
      reference: 'VTU-OWNED',
      status: 'processing',
    });

    const response = await GET(
      makeRequest('?merchantSlug=ogabassey&type=electricity')
    );
    expect(response.status).toBe(200);

    for (const [callback] of mockAfter.mock.calls) {
      await (callback as () => Promise<void>)();
    }

    expect(mockFulfillPendingVtuTransaction).toHaveBeenCalledTimes(1);
    expect(mockFulfillPendingVtuTransaction).toHaveBeenCalledWith({
      supabase: expect.any(Object),
      transactionId: 'tx-owned',
    });
    expect(vtuTransactionUpdateEqCalls).not.toContainEqual([
      'id',
      'tx-foreign',
    ]);
  });

  it('does not wait for voucher-pin backfill scheduling before returning history', async () => {
    const { GET } = await import('./route');
    let resolveBackfillClaim:
      | ((value: { data: Record<string, unknown>[]; error: unknown }) => void)
      | undefined;
    vtuTransactionUpdateSelectPromise = new Promise((resolve) => {
      resolveBackfillClaim = resolve;
    });
    transactionsData = [
      {
        id: 'tx-1',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-1',
        type: 'electricity',
        status: 'successful',
        amount: '2500',
        biller_name: 'EKEDC NG',
        metadata: {},
        request_reference: 'VTU-123',
        transaction_id: 'kuda-bill-1',
        customer_cashback: '0',
      },
    ];
    paymentRowsData = [];

    const responsePromise = GET(
      makeRequest('?merchantSlug=ogabassey&type=electricity')
    );
    // The race checks that the response is not coupled to the mocked
    // backfill-claim promise; the explicit after/backfill assertions below
    // verify that the deferred work was queued instead of dropped.
    const raceResult = await Promise.race([
      responsePromise.then(() => 'response'),
      new Promise((resolve) => setTimeout(() => resolve('blocked'), 0)),
    ]);

    expect(raceResult).toBe('response');
    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(vtuTransactionUpdatePayloads).toEqual([]);
    expect(mockBackfillVtuVoucherPin).not.toHaveBeenCalled();

    const scheduledBackfillClaim = mockAfter.mock.calls[0]?.[0] as
      | (() => Promise<void>)
      | undefined;
    expect(scheduledBackfillClaim).toBeDefined();
    if (!scheduledBackfillClaim) {
      throw new Error('Expected voucher-pin backfill claim to be scheduled');
    }

    const scheduledBackfillClaimPromise = scheduledBackfillClaim();
    // The scheduled callback reaches the mocked update builder before its
    // first awaited branch, so one microtask tick is enough to observe the
    // claim payload while scheduledBackfillClaimPromise is still pending.
    await Promise.resolve();

    expect(vtuTransactionUpdatePayloads).toEqual([
      {
        metadata: expect.objectContaining({
          voucherPinBackfillScheduledAt: expect.any(String),
        }),
      },
    ]);
    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(mockBackfillVtuVoucherPin).not.toHaveBeenCalled();

    resolveBackfillClaim?.({ data: [{ id: 'tx-1' }], error: null });
    await scheduledBackfillClaimPromise;
    expect(mockAfter).toHaveBeenCalledTimes(2);
    expect(mockBackfillVtuVoucherPin).not.toHaveBeenCalled();

    const response = await responsePromise;
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.transactions).toEqual([
      expect.objectContaining({
        id: 'tx-1',
        voucher_pin: null,
      }),
    ]);
  });

  it('does not reschedule voucher-pin backfill when metadata already has a recent schedule marker', async () => {
    const { GET } = await import('./route');
    const dateNowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse('2026-04-29T12:00:01.000Z'));
    transactionsData = [
      {
        id: 'tx-1',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-1',
        type: 'electricity',
        status: 'successful',
        amount: '2500',
        biller_name: 'EKEDC NG',
        metadata: {
          voucherPinBackfillScheduledAt: '2026-04-29T12:00:00.000Z',
        },
        request_reference: 'VTU-123',
        transaction_id: 'kuda-bill-1',
        customer_cashback: '0',
      },
    ];
    paymentRowsData = [];

    try {
      const response = await GET(
        makeRequest('?merchantSlug=ogabassey&type=electricity')
      );
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.transactions).toEqual([
        expect.objectContaining({
          id: 'tx-1',
          voucher_pin: null,
        }),
      ]);
      expect(mockAfter).not.toHaveBeenCalled();
      expect(mockBackfillVtuVoucherPin).not.toHaveBeenCalled();
      expect(vtuTransactionUpdatePayloads).toEqual([]);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('returns history when payment status lookup fails', async () => {
    const { GET } = await import('./route');
    transactionsData = [
      {
        id: 'tx-1',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-1',
        type: 'airtime',
        status: 'successful',
        amount: '2500',
        biller_name: 'EKEDC NG',
        metadata: {
          paymentReference: 'VTU-PAYSTACK-123',
        },
        request_reference: 'VTU-123',
        transaction_id: null,
        customer_cashback: '0',
      },
    ];
    paymentRowsError = { message: 'lookup failed' };

    const response = await GET(
      makeRequest('?merchantSlug=ogabassey&type=airtime')
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.transactions).toEqual([
      expect.objectContaining({
        id: 'tx-1',
        payment_status: null,
      }),
    ]);
    expect(mockAfter).not.toHaveBeenCalled();
    expect(mockBackfillVtuVoucherPin).not.toHaveBeenCalled();
    expect(vtuTransactionUpdatePayloads).toEqual([]);
  });

  it('matches payment statuses by gateway and reference', async () => {
    const { GET } = await import('./route');
    transactionsData = [
      {
        id: 'tx-paystack',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-1',
        type: 'airtime',
        status: 'successful',
        amount: '2500',
        biller_name: 'MTN',
        metadata: {
          gateway: 'paystack',
          paymentReference: 'SHARED-REF',
        },
        request_reference: 'VTU-PAYSTACK',
        transaction_id: null,
        customer_cashback: '0',
      },
      {
        id: 'tx-korapay',
        created_at: '2026-04-08T12:01:00.000Z',
        customer_id: 'customer-1',
        type: 'airtime',
        status: 'successful',
        amount: '2500',
        biller_name: 'MTN',
        metadata: {
          gateway: 'korapay',
          paymentReference: 'SHARED-REF',
        },
        request_reference: 'VTU-KORAPAY',
        transaction_id: null,
        customer_cashback: '0',
      },
    ];
    paymentRowsData = [
      {
        gateway: 'paystack',
        gateway_reference: 'SHARED-REF',
        status: 'completed',
      },
      {
        gateway: 'korapay',
        gateway_reference: 'SHARED-REF',
        status: 'failed',
      },
    ];

    const response = await GET(makeRequest('?merchantSlug=ogabassey'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.transactions).toEqual([
      expect.objectContaining({
        id: 'tx-paystack',
        payment_gateway: 'paystack',
        payment_reference: 'SHARED-REF',
        payment_status: 'completed',
      }),
      expect.objectContaining({
        id: 'tx-korapay',
        payment_gateway: 'korapay',
        payment_reference: 'SHARED-REF',
        payment_status: 'failed',
      }),
    ]);
  });

  it('returns an empty list when no customer exists for the authenticated user', async () => {
    const { GET } = await import('./route');
    customerByUserIdData = null;
    customerByEmailData = null;

    const response = await GET(makeRequest('?merchantSlug=ogabassey'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.transactions).toEqual([]);
  });

  it('flags a failed debited row with no issued refund as refund-pending', async () => {
    // Failed persists before the refund RPC runs: clients must keep
    // polling (and never claim the refund) until this clears.
    const { GET } = await import('./route');
    transactionsData = [
      {
        id: 'tx-failed',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-1',
        type: 'electricity',
        status: 'failed',
        amount: '1000',
        metadata: { walletDebited: true },
        request_reference: 'VTU-FAIL',
        customer_cashback: '0',
        source: 'checkout',
      },
    ];

    const response = await GET(makeRequest('?merchantSlug=ogabassey'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.transactions).toEqual([
      expect.objectContaining({
        id: 'tx-failed',
        refund_pending: true,
        refunded_to_wallet: null,
      }),
    ]);
  });

  it('exposes the confirmed refund amount once issued', async () => {
    const { GET } = await import('./route');
    transactionsData = [
      {
        id: 'tx-refunded',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-1',
        type: 'electricity',
        status: 'failed',
        amount: '1000',
        metadata: {
          walletDebited: true,
          refundIssued: true,
          refundAmount: 1000,
        },
        request_reference: 'VTU-REFUNDED',
        customer_cashback: '0',
      },
    ];

    const response = await GET(makeRequest('?merchantSlug=ogabassey'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.transactions).toEqual([
      expect.objectContaining({
        id: 'tx-refunded',
        refund_pending: false,
        refunded_to_wallet: 1000,
      }),
    ]);
  });

  it('totals the reversed wallet leg for wallet-only failures', async () => {
    // The persisted refundAmount is the card leg (0 here); the wallet
    // leg carries the restoration — the view must show ₦1,000, not ₦0.
    const { GET } = await import('./route');
    transactionsData = [
      {
        id: 'tx-wallet-only',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-1',
        type: 'electricity',
        status: 'failed',
        amount: '1000',
        metadata: {
          walletDebited: true,
          refundIssued: true,
          refundAmount: 0,
          paymentSplit: { wallet: 1000, card: 0 },
        },
        request_reference: 'VTU-WO',
        customer_cashback: '0',
      },
      {
        id: 'tx-hybrid',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-1',
        type: 'electricity',
        status: 'failed',
        amount: '1000',
        metadata: {
          walletDebited: true,
          refundIssued: true,
          refundAmount: 700,
          paymentSplit: { wallet: 300, card: 700 },
        },
        request_reference: 'VTU-HY',
        customer_cashback: '0',
      },
    ];

    const response = await GET(makeRequest('?merchantSlug=ogabassey'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.transactions).toEqual([
      expect.objectContaining({
        id: 'tx-wallet-only',
        refund_pending: false,
        refunded_to_wallet: 1000,
      }),
      expect.objectContaining({
        id: 'tx-hybrid',
        refund_pending: false,
        refunded_to_wallet: 1000,
      }),
    ]);
  });

  it('flags a failed card-only checkout with no markers as refund-pending', async () => {
    // Legacy card-only rows carry no split and no walletDebited marker,
    // but refundCardOnly still owes the full amount — pending until
    // refundIssued lands, never an explicit false.
    const { GET } = await import('./route');
    transactionsData = [
      {
        id: 'tx-card-only',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-1',
        type: 'electricity',
        status: 'failed',
        amount: '1000',
        metadata: {},
        request_reference: 'VTU-CARD-ONLY',
        customer_cashback: '0',
        source: 'checkout',
      },
    ];

    const response = await GET(makeRequest('?merchantSlug=ogabassey'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.transactions).toEqual([
      expect.objectContaining({
        id: 'tx-card-only',
        refund_pending: true,
        refunded_to_wallet: null,
      }),
    ]);
    // The refund inputs that decided pending stay out of the response.
    expect(data.transactions[0]).not.toHaveProperty('source');
    expect(data.transactions[0]).not.toHaveProperty('customer_id');
  });

  it('never flags successful or non-checkout rows as refund-pending', async () => {
    const { GET } = await import('./route');
    transactionsData = [
      {
        id: 'tx-ok',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-1',
        type: 'electricity',
        status: 'successful',
        amount: '1000',
        metadata: { walletDebited: true },
        request_reference: 'VTU-OK',
        customer_cashback: '0',
      },
      {
        id: 'tx-failed-noncheckout',
        created_at: '2026-04-08T12:00:00.000Z',
        customer_id: 'customer-1',
        type: 'electricity',
        status: 'failed',
        amount: '1000',
        metadata: {},
        request_reference: 'VTU-NONCHECKOUT',
        customer_cashback: '0',
        source: 'admin',
      },
    ];

    const response = await GET(makeRequest('?merchantSlug=ogabassey'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.transactions).toEqual([
      expect.objectContaining({ id: 'tx-ok', refund_pending: false }),
      expect.objectContaining({
        id: 'tx-failed-noncheckout',
        refund_pending: false,
        refunded_to_wallet: null,
      }),
    ]);
  });

  it('resolves a stale slug via the alias fallback instead of 404', async () => {
    // Store renamed while a processing tab stayed open: the tab polls
    // with the retired slug, which must resolve, not strand the
    // backfill on a permanent 404.
    merchantData = null;
    merchantDataBySlug = {
      'old-slug': null,
      'new-slug': { id: 'merchant-1' },
    };
    mockGetCurrentSlugForAliasStrict.mockResolvedValue('new-slug');
    const { GET } = await import('./route');

    const response = await GET(makeRequest('?merchantSlug=old-slug'));
    const data = await response.json();

    expect(mockGetCurrentSlugForAliasStrict).toHaveBeenCalledWith('old-slug');
    expect(mockGetCurrentSlugForAlias).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(data.transactions).toHaveLength(1);
  });

  it('returns 404 for an unknown slug with no alias', async () => {
    merchantData = null;
    mockGetCurrentSlugForAliasStrict.mockResolvedValue(null);
    const { GET } = await import('./route');

    const response = await GET(makeRequest('?merchantSlug=nope'));
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Merchant not found');
  });

  it('returns 500 (retryable) when the alias lookup fails', async () => {
    merchantData = null;
    mockGetCurrentSlugForAliasStrict.mockRejectedValue(
      new Error('[Slug Alias Cache] alias lookup failed for slug: old-slug')
    );
    const { GET } = await import('./route');

    const response = await GET(makeRequest('?merchantSlug=old-slug'));
    const data = await response.json();

    // 404 would strand the backfill (it treats 4xx as terminal);
    // 5xx keeps it retrying through the transient blip.
    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to fetch history');
  });

  it('returns 500 (retryable) when the merchant lookup errors', async () => {
    merchantData = null;
    merchantError = { message: 'connection reset' };
    const { GET } = await import('./route');

    const response = await GET(makeRequest('?merchantSlug=ogabassey'));
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to fetch history');
  });

  it('returns 500 (retryable) when the customer lookup errors', async () => {
    // A transient DB blip must not present as empty history:
    // pollers treat 2xx-empty as terminal (burning their finite
    // budget) but retry 5xx (Codex R55 6rrMIW).
    customerLookupError = { message: 'connection reset' };
    const { GET } = await import('./route');

    const response = await GET(makeRequest('?merchantSlug=ogabassey'));
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to fetch history');
  });

  it('returns 500 (retryable) when the email-fallback lookup errors', async () => {
    customerByUserIdData = null;
    customerLookupError = { message: 'connection reset' };
    const { GET } = await import('./route');

    const response = await GET(makeRequest('?merchantSlug=ogabassey'));
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to fetch history');
  });
});
