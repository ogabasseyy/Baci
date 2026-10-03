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

describe('useReceipts settled history', () => {
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

  it('demotes promoted rows whose settled history the sender rejects', async () => {
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
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          order_id: 'order-1',
          amount: -50,
          status: 'completed',
          transaction_type: 'payment',
          created_at: '2026-07-08T12:34:00.000Z',
          description: null,
          dva_account_number: null,
          gateway: null,
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
      document_kind: string;
    }>;

    // Order/item data promotes, but the sender rejects the negative
    // settled payment — the list must badge invoice, like the archive.
    expect(receipts.map((row) => row.document_kind)).toEqual(['invoice']);
  });

  it('keeps promoted rows when settled history is valid', async () => {
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
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          order_id: 'order-1',
          amount: 500,
          status: 'completed',
          transaction_type: 'payment',
          created_at: '2026-07-08T12:34:00.000Z',
          description: null,
          dva_account_number: null,
          gateway: null,
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
      document_kind: string;
      transaction_date: string;
    }>;

    expect(receipts.map((row) => row.document_kind)).toEqual(['receipt']);
    // Valid history still dates the receipt by its completing payment.
    expect(receipts[0]?.transaction_date).toBe('2026-07-08T12:34:00.000Z');
  });
});
