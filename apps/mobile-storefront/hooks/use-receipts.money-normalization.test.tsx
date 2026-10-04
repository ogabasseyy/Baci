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
const mockRpc = jest.fn((_fn: string, _args: unknown) => ({}));
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

describe('useReceipts money normalization', () => {
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

  it('normalizes numeric-string totals so the card never formats raw values', async () => {
    const { useReceipts } = await import('@/hooks/use-receipts');
    mockOrder.mockResolvedValue({
      data: [
        {
          amount_paid: '95000.00',
          created_at: '2026-04-02T10:00:00.000Z',
          transaction_date: '2026-04-02T10:00:00.000Z',
          invoice_issue_date: null,
          currency: 'NGN',
          id: 'order-string-money',
          order_items: [],
          order_number: 'ORD-3003',
          payment_status: 'paid',
          total: '95000.00',
        },
        {
          amount_paid: null,
          created_at: '2026-04-03T10:00:00.000Z',
          transaction_date: '2026-04-03T10:00:00.000Z',
          invoice_issue_date: null,
          currency: 'NGN',
          id: 'order-bad-money',
          order_items: [],
          order_number: 'ORD-3004',
          payment_status: 'unpaid',
          total: 'not-a-number',
        },
        {
          amount_paid: true,
          created_at: '2026-04-04T10:00:00.000Z',
          transaction_date: '2026-04-04T10:00:00.000Z',
          invoice_issue_date: null,
          currency: 'NGN',
          id: 'order-loose-money',
          order_items: [],
          order_number: 'ORD-3005',
          payment_status: 'unpaid',
          total: '0x10',
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
      total: number;
      amount_paid: number;
    }>;
    const byId = new Map(receipts.map((receipt) => [receipt.id, receipt]));

    expect(byId.get('order-string-money')).toMatchObject({
      total: 95000,
      amount_paid: 95000,
    });
    expect(byId.get('order-bad-money')).toMatchObject({
      total: 0,
      amount_paid: 0,
    });
    expect(byId.get('order-loose-money')).toMatchObject({
      total: 0,
      amount_paid: 0,
    });
  });
});
