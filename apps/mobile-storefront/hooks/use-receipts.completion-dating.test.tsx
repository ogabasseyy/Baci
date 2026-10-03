import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { View } from 'react-native';

type QueryOptions = {
  enabled?: boolean;
  queryFn: () => Promise<unknown>;
};

type SupabaseListResponse = {
  data: unknown[] | null;
  error: Error | null;
};

type SupabaseSingleResponse = {
  data: unknown;
  error: Error | null;
};

type MockAuthState = {
  merchantId: string | null;
  user: { id: string } | null;
};

const mockUseQuery = jest.fn((options: unknown) => options);
const mockWithSupabaseRetry = jest.fn(
  async (callback: () => Promise<unknown>) => callback()
);
const mockAuthState: MockAuthState = {
  merchantId: 'merchant-1',
  user: { id: 'auth-user-1' },
};
const mockOrder = jest.fn<() => Promise<SupabaseListResponse>>();
const mockSingle = jest.fn<() => Promise<SupabaseSingleResponse>>();
const mockLimit = jest.fn<() => Promise<SupabaseListResponse>>();
const mockQueryBuilder = {
  eq: jest.fn((_field: string, _value: string) => mockQueryBuilder),
  limit: mockLimit,
  order: mockOrder,
  select: jest.fn((_columns: string) => mockQueryBuilder),
  single: mockSingle,
};
const mockFrom = jest.fn((_table: string) => mockQueryBuilder);
// fetchReceiptDetail also reads payment-account/transaction RPCs; resolve them
// as empty so detail-prefetch tests exercise the query scoping, not the RPCs.
const mockRpc = jest.fn(
  async (
    _fn: string,
    _args?: unknown
  ): Promise<{ data: unknown; error: Error | null }> => ({
    data: undefined,
    error: null,
  })
);
const mockUseAuthStore = Object.assign(
  jest.fn((selector: (state: MockAuthState) => unknown) =>
    selector(mockAuthState)
  ),
  {
    getState: jest.fn(() => mockAuthState),
  }
);

jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => mockUseQuery(options),
}));

jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (callback: () => Promise<unknown>) =>
    mockWithSupabaseRetry(callback),
}));

jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: 'merchant-1', MERCHANT_SLUG: 'ogabassey' },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: mockUseAuthStore,
}));

describe('useReceipts completion dating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrder.mockReset();
    mockAuthState.merchantId = 'merchant-1';
    mockAuthState.user = { id: 'auth-user-1' };
    mockOrder.mockResolvedValue({ data: [], error: null });
    mockOrder.mockImplementationOnce(() => mockQueryBuilder as never);
    mockSingle.mockResolvedValue({ data: null, error: null });
    mockLimit.mockResolvedValue({ data: [], error: null });
  });

  it('dates promoted receipts by their completing payment', async () => {
    const { useReceipts } = await import('@/hooks/use-receipts');
    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'order-september-invoice',
          order_number: 'ORD-21',
          payment_status: 'unpaid',
          shipping_status: 'delivered',
          recorded_by_user_id: null,
          import_job_id: null,
          external_source: null,
          total: 150000,
          subtotal: 150000,
          shipping_fee: 0,
          tax_amount: 0,
          discount_amount: 0,
          amount_paid: 0,
          currency: 'NGN',
          created_at: '2026-09-12T10:00:00.000Z',
          transaction_date: '2026-09-12T10:00:00.000Z',
          invoice_issue_date: '2026-09-12',
          order_items: [],
        },
        {
          id: 'order-covered-manual',
          order_number: 'MANUAL-22',
          payment_status: 'pending',
          shipping_status: 'processing',
          recorded_by_user_id: 'staff-1',
          import_job_id: null,
          external_source: null,
          total: 500,
          subtotal: 500,
          shipping_fee: 0,
          tax_amount: 0,
          discount_amount: 0,
          amount_paid: 500,
          currency: 'NGN',
          created_at: '2026-01-10T10:00:00.000Z',
          transaction_date: '2026-01-10T10:00:00.000Z',
          invoice_issue_date: '2026-01-10',
          order_items: [
            { id: 'item-1', name: 'Phone', quantity: 1, price: 500 },
          ],
        },
      ],
      error: null,
    });
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          order_id: 'order-covered-manual',
          amount: 500,
          created_at: '2026-10-05T12:00:00.000Z',
          description: null,
          gateway: null,
          status: 'completed',
          transaction_type: 'payment',
          dva_account_number: null,
        },
      ],
      error: null,
    });

    function Probe() {
      useReceipts('auth-user-1');
      return <View testID="probe" />;
    }

    render(<Probe />);
    const options = mockUseQuery.mock.calls[0]?.[0] as QueryOptions;
    const receipts = (await options.queryFn()) as Array<{
      id: string;
      document_kind: string;
      transaction_date: string | null;
      invoice_issue_date: string | null;
    }>;

    // Only receipt-kind rows need completion dating.
    expect(mockRpc).toHaveBeenCalledWith('get_customer_order_transactions', {
      p_order_ids: ['order-covered-manual'],
    });
    // The card displays the October completion date, so the January-issued
    // receipt must file above the September invoice.
    expect(receipts.map((receipt) => receipt.id)).toEqual([
      'order-covered-manual',
      'order-september-invoice',
    ]);
    expect(receipts[0]).toEqual(
      expect.objectContaining({
        document_kind: 'receipt',
        transaction_date: '2026-10-05T12:00:00.000Z',
        invoice_issue_date: null,
      })
    );
  });

  it('fails the list load when receipt transaction dating fails', async () => {
    const { useReceipts } = await import('@/hooks/use-receipts');
    mockOrder.mockResolvedValue({
      data: [
        {
          id: 'order-1',
          order_number: 'ORD-1',
          payment_status: 'pending',
          shipping_status: 'processing',
          recorded_by_user_id: 'staff-1',
          import_job_id: null,
          external_source: null,
          total: 500,
          subtotal: 500,
          shipping_fee: 0,
          tax_amount: 0,
          discount_amount: 0,
          amount_paid: 500,
          currency: 'NGN',
          created_at: '2026-07-08T12:33:00.000Z',
          order_items: [
            { id: 'item-1', name: 'Phone', quantity: 1, price: 500 },
          ],
        },
      ],
      error: null,
    });
    mockRpc.mockRejectedValueOnce(new Error('transaction lookup failed'));

    function Probe() {
      useReceipts('auth-user-1');
      return <View testID="probe" />;
    }

    render(<Probe />);
    const options = mockUseQuery.mock.calls[0]?.[0] as QueryOptions;

    // A promoted receipt must never file under a stale invoice date: like
    // the web orders route, the whole load fails instead of misdating.
    await expect(options.queryFn()).rejects.toThrow(
      'transaction lookup failed'
    );
  });
});
