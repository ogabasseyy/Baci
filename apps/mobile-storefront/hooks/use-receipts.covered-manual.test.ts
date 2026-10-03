import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type SupabaseMockResult = Promise<{ data: unknown; error: unknown }>;

const mockOrderSingle = jest.fn<() => SupabaseMockResult>();
const mockTransactionsRpc =
  jest.fn<(fn: string, args: unknown) => SupabaseMockResult>();

jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (operation: () => Promise<unknown>) => operation(),
}));

jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_SLUG: 'ogabassey' },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn() }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      if (fn === 'get_customer_order_transactions') {
        return mockTransactionsRpc(fn, args);
      }
      return Promise.resolve({ data: [], error: null });
    },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ eq: () => ({ single: mockOrderSingle }) }) }),
      }),
    }),
  },
}));

jest.mock('@/hooks/use-merchant-receipt-info', () => ({
  useMerchantReceiptInfo: () => ({ data: null }),
}));

import { receiptDetailQueryOptions } from './use-receipts';

const scope = { merchantId: 'merchant-1', userId: 'user-1' };

describe('receipt detail covered-manual transaction failures', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fails closed when a covered-manual transaction lookup fails', async () => {
    // A covered manual balance promotes to a receipt dated from its
    // transactions: swallowing the lookup error would render a misdated
    // receipt, so the whole detail load must fail like a paid order.
    const error = new Error('customer transaction lookup failed');
    mockOrderSingle.mockResolvedValue({
      data: {
        payment_status: 'pending',
        recorded_by_user_id: 'staff-1',
        import_job_id: null,
        external_source: null,
        total: 500,
        amount_paid: 500,
      },
      error: null,
    });
    mockTransactionsRpc.mockResolvedValue({ data: null, error });

    await expect(
      receiptDetailQueryOptions('order-1', scope).queryFn()
    ).rejects.toBe(error);
  });

  it('tolerates transaction lookup failures for uncovered manual invoices', async () => {
    // Uncovered invoices are not dated from payments, so a failed lookup
    // still resolves (empty history) instead of blocking the preview.
    mockOrderSingle.mockResolvedValue({
      data: {
        payment_status: 'pending',
        recorded_by_user_id: 'staff-1',
        import_job_id: null,
        external_source: null,
        total: 500,
        amount_paid: 100,
      },
      error: null,
    });
    mockTransactionsRpc.mockResolvedValue({
      data: null,
      error: new Error('customer transaction lookup failed'),
    });

    const detail = await receiptDetailQueryOptions('order-1', scope).queryFn();
    expect(detail.transactions).toEqual([]);
  });
});
