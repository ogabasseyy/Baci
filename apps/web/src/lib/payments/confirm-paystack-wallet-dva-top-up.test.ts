import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmPaystackWalletDvaTopUp } from '@/lib/payments/confirm-paystack-wallet-dva-top-up';

const mockFindCustomerWalletPaymentAccountByReceiver = vi.hoisted(() =>
  vi.fn()
);
const mockCaptureServerEvent = vi.hoisted(() => vi.fn());

vi.mock('@/lib/customer-wallet-payment-accounts', () => ({
  findCustomerWalletPaymentAccountByReceiver: (...args: unknown[]) =>
    mockFindCustomerWalletPaymentAccountByReceiver(...args),
}));

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: mockCaptureServerEvent,
}));

const walletAccount = {
  accountName: 'Ogabassey/Jane Doe',
  accountNumber: '1234567890',
  bankName: 'Titan Paystack',
  bankSlug: 'titan-paystack',
  consentedAt: '2026-05-21T10:00:00.000Z',
  currency: 'NGN' as const,
  customerId: 'customer-1',
  id: 'wallet-payment-account-1',
  merchantId: 'merchant-1',
  metadata: {},
  provider: 'paystack' as const,
  providerAccountId: '99',
  providerCustomerCode: 'CUS_123',
  providerSubaccountCode: 'ACCT_merchant123',
  status: 'active' as const,
};

const transactionRow = {
  amount: '20000',
  currency: 'NGN',
  gateway_reference: 'PSK_REF_1',
  id: 'txn-1',
  merchant_id: 'merchant-1',
  metadata: {
    customer_id: 'customer-1',
    transaction_type: 'wallet_topup',
  },
  order_id: null,
  platform_fee: '0',
};

function createThenableRowsQuery(data: unknown[]) {
  const query: Record<string, unknown> = {};
  const select = vi.fn(() => query);
  const eq = vi.fn(() => query);
  const then = (resolve: unknown, reject: unknown) =>
    Promise.resolve({ data, error: null }).then(
      resolve as Parameters<Promise<unknown>['then']>[0],
      reject as Parameters<Promise<unknown>['then']>[1]
    );
  Object.assign(query, { eq, select, then });
  return query;
}

function createTransactionReadQuery({
  data = transactionRow,
  error = null,
}: {
  data?: unknown;
  error?: unknown;
} = {}) {
  const query: Record<string, unknown> = {};
  const select = vi.fn(() => query);
  const eq = vi.fn(() => query);
  const single = vi.fn().mockResolvedValue({ data, error });
  Object.assign(query, { eq, select, single });
  return query;
}

function createReviewInsertQuery() {
  const query: Record<string, unknown> = {};
  const insert = vi.fn().mockResolvedValue({ data: null, error: null });
  Object.assign(query, { insert });
  return { insert, query };
}

describe('confirmPaystackWalletDvaTopUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindCustomerWalletPaymentAccountByReceiver.mockResolvedValue(
      walletAccount
    );
  });

  it('returns none when the receiver account has no wallet funding account', async () => {
    mockFindCustomerWalletPaymentAccountByReceiver.mockResolvedValue(null);
    const supabase = {
      from: vi.fn(),
    } as unknown as SupabaseClient;

    await expect(
      confirmPaystackWalletDvaTopUp({
        accountNumber: '1234567890',
        gatewayReference: 'PSK_REF_1',
        paystackResponse: {},
        supabase,
        verifiedAmount: { amount: 20000, currency: 'NGN' },
      })
    ).resolves.toEqual({ kind: 'none' });

    expect(supabase.from).not.toHaveBeenCalled();
  });

  it.each([
    { accountNumber: null, verifiedAmount: { amount: 20000, currency: 'NGN' } },
    { accountNumber: '1234567890', verifiedAmount: null },
  ])('returns none before querying when required receiver details are missing', async ({
    accountNumber,
    verifiedAmount,
  }) => {
    const supabase = {
      from: vi.fn(),
    } as unknown as SupabaseClient;

    await expect(
      confirmPaystackWalletDvaTopUp({
        accountNumber,
        gatewayReference: 'PSK_REF_1',
        paystackResponse: {},
        supabase,
        verifiedAmount,
      })
    ).resolves.toEqual({ kind: 'none' });

    expect(
      mockFindCustomerWalletPaymentAccountByReceiver
    ).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('creates a pending wallet top-up transaction for a wallet DVA receiver', async () => {
    const orderAliasQuery = createThenableRowsQuery([]);
    const rpc = vi.fn().mockResolvedValue({ data: 'txn-1', error: null });
    const transactionQuery = createTransactionReadQuery();
    const supabase = {
      rpc,
      from: vi.fn((table: string) => {
        if (table === 'order_payment_accounts') return orderAliasQuery;
        if (table === 'transactions') return transactionQuery;
        throw new Error(`Unexpected table ${table}`);
      }),
    } as unknown as SupabaseClient;

    const result = await confirmPaystackWalletDvaTopUp({
      accountNumber: '1234567890',
      gatewayReference: 'PSK_REF_1',
      paystackResponse: {
        customer: { email: 'jane@example.com' },
        paid_at: '2026-05-21T10:00:00.000Z',
      },
      supabase,
      verifiedAmount: { amount: 20000, currency: 'NGN' },
    });

    expect(result).toMatchObject({
      kind: 'match',
      transaction: { id: 'txn-1', merchant_id: 'merchant-1' },
    });
    expect(rpc).toHaveBeenCalledWith(
      'claim_paystack_wallet_dva_transaction',
      expect.objectContaining({
        p_amount: 20000,
        p_currency: 'NGN',
        p_merchant_id: 'merchant-1',
        p_reference: 'PSK_REF_1',
        p_metadata: expect.objectContaining({
          customer_email: 'jane@example.com',
          customer_id: 'customer-1',
          transaction_type: 'wallet_topup',
          wallet_payment_account_id: 'wallet-payment-account-1',
        }),
      })
    );
    // The fresh insert is only the PENDING transaction match — the credited
    // funnel event belongs to creditWalletTopUp, which credits the balance.
    expect(mockCaptureServerEvent).not.toHaveBeenCalled();
  });

  it('files a review and does not credit wallet when an active order DVA aliases the receiver', async () => {
    const orderAliasQuery = createThenableRowsQuery([
      {
        created_at: '2026-05-21T09:45:00.000Z',
        expires_at: '2026-05-21T11:15:00.000Z',
        order_id: 'order-1',
        orders: { id: 'order-1', payment_status: 'pending' },
      },
    ]);
    const { insert, query: reviewQuery } = createReviewInsertQuery();
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'order_payment_accounts') return orderAliasQuery;
        if (table === 'reconciliation_review') return reviewQuery;
        throw new Error(`Unexpected table ${table}`);
      }),
    } as unknown as SupabaseClient;

    const result = await confirmPaystackWalletDvaTopUp({
      accountNumber: '1234567890',
      gatewayReference: 'PSK_REF_1',
      paystackResponse: { paid_at: '2026-05-21T10:00:00.000Z' },
      supabase,
      verifiedAmount: { amount: 20000, currency: 'NGN' },
    });

    expect(result).toMatchObject({
      body: { code: 'WALLET_DVA_ORDER_ALIAS_CONFLICT' },
      kind: 'review',
      status: 200,
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'wallet_dva_order_alias_conflict',
        paystack_ref: 'PSK_REF_1',
      })
    );
    expect(mockCaptureServerEvent).not.toHaveBeenCalled();
  });

  it('reuses the existing transaction id when the gateway reference was already claimed', async () => {
    const orderAliasQuery = createThenableRowsQuery([]);
    const rpc = vi.fn().mockResolvedValue({ data: 'txn-winner', error: null });
    const rereadQuery = createTransactionReadQuery({
      data: { ...transactionRow, id: 'txn-winner' },
    });
    const supabase = {
      rpc,
      from: vi
        .fn()
        .mockReturnValueOnce(orderAliasQuery)
        .mockReturnValueOnce(rereadQuery),
    } as unknown as SupabaseClient;

    const result = await confirmPaystackWalletDvaTopUp({
      accountNumber: '1234567890',
      gatewayReference: 'PSK_REF_1',
      paystackResponse: { paid_at: '2026-05-21T10:00:00.000Z' },
      supabase,
      verifiedAmount: { amount: 20000, currency: 'NGN' },
    });

    expect(result).toMatchObject({
      kind: 'match',
      transaction: { id: 'txn-winner' },
    });
    // This lib never emits the funnel-completion event on any branch — that
    // belongs to creditWalletTopUp's fresh-credit path.
    expect(mockCaptureServerEvent).not.toHaveBeenCalled();
  });

  it('throws wallet reference claim errors', async () => {
    const orderAliasQuery = createThenableRowsQuery([]);
    const claimError = { code: 'XXXXX', message: 'boom' };
    const rpc = vi.fn().mockResolvedValue({ data: null, error: claimError });
    const supabase = {
      rpc,
      from: vi.fn().mockReturnValueOnce(orderAliasQuery),
    } as unknown as SupabaseClient;

    await expect(
      confirmPaystackWalletDvaTopUp({
        accountNumber: '1234567890',
        gatewayReference: 'PSK_REF_1',
        paystackResponse: { paid_at: '2026-05-21T10:00:00.000Z' },
        supabase,
        verifiedAmount: { amount: 20000, currency: 'NGN' },
      })
    ).rejects.toBe(claimError);
  });
});
