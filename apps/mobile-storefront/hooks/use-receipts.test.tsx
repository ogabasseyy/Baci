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

describe('useReceipts', () => {
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

  it('loads receipts through the customer linked to the authenticated user and merchant', async () => {
    const { useReceipts } = await import('@/hooks/use-receipts');
    mockOrder.mockResolvedValue({
      data: [
        {
          amount_paid: 690000,
          created_at: '2026-07-08T12:33:00.000Z',
          currency: 'NGN',
          id: 'order-1',
          order_items: [
            {
              condition: 'open_box',
              id: 'item-1',
              name: '13" MacBook Air M2 (2022)',
              price: 690000,
              quantity: 1,
              variant_name: '512GB',
            },
          ],
          order_number: 'ORD-1',
          payment_status: 'pending',
          total: 690000,
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
    const receipts = await options.queryFn();

    expect(mockFrom).toHaveBeenCalledWith('orders');
    expect(mockQueryBuilder.select).toHaveBeenCalledWith(
      expect.stringContaining('customers!inner')
    );
    expect(mockQueryBuilder.select).toHaveBeenCalledWith(
      expect.stringContaining('condition')
    );
    expect(mockQueryBuilder.select).toHaveBeenCalledWith(
      expect.stringContaining('variant_name')
    );
    expect(mockQueryBuilder.eq).toHaveBeenCalledWith(
      'customers.user_id',
      'auth-user-1'
    );
    expect(mockQueryBuilder.eq).toHaveBeenCalledWith(
      'merchant_id',
      'merchant-1'
    );
    expect(mockOrder).toHaveBeenNthCalledWith(1, 'transaction_date', {
      ascending: false,
      nullsFirst: false,
    });
    expect(mockOrder).toHaveBeenNthCalledWith(2, 'created_at', {
      ascending: false,
    });
    expect(receipts).toEqual([
      expect.objectContaining({
        items: [
          expect.objectContaining({
            condition: 'open_box',
            product_name: '13" MacBook Air M2 (2022)',
            variant_name: '512GB',
          }),
        ],
      }),
    ]);
  });

  it('files a backdated invoice by its issue date, not its transaction date', async () => {
    const { useReceipts } = await import('@/hooks/use-receipts');
    mockOrder.mockResolvedValue({
      data: [
        {
          amount_paid: 95000,
          created_at: '2026-04-02T10:00:00.000Z',
          transaction_date: '2026-04-02T10:00:00.000Z',
          invoice_issue_date: null,
          currency: 'NGN',
          id: 'order-april',
          order_items: [],
          order_number: 'ORD-3002',
          payment_status: 'paid',
          total: 95000,
        },
        {
          amount_paid: 150000,
          created_at: '2026-03-05T10:00:00.000Z',
          transaction_date: '2026-03-05T10:00:00.000Z',
          invoice_issue_date: '2026-09-12',
          currency: 'NGN',
          id: 'order-backdated',
          order_items: [],
          order_number: 'ORD-3001',
          payment_status: 'paid',
          total: 150000,
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
    const receipts = (await options.queryFn()) as Array<{ id: string }>;

    // The receipt card renders the September issue date first, so the invoice
    // issued in September must file above the April receipt even though its
    // transaction is older.
    expect(receipts.map((receipt) => receipt.id)).toEqual([
      'order-backdated',
      'order-april',
    ]);
  });

  it('does not query receipts when the authenticated user scope is missing', async () => {
    const { useReceipts } = await import('@/hooks/use-receipts');

    function Probe() {
      useReceipts(undefined);
      return <View testID="probe" />;
    }

    render(<Probe />);
    const options = mockUseQuery.mock.calls[0]?.[0] as QueryOptions;

    expect(options.enabled).toBe(false);
    await expect(options.queryFn()).resolves.toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('propagates receipt list Supabase errors', async () => {
    const { useReceipts } = await import('@/hooks/use-receipts');
    mockOrder.mockResolvedValue({
      data: null,
      error: new Error('receipt list failed'),
    });

    function Probe() {
      useReceipts('auth-user-1');
      return <View testID="probe" />;
    }

    render(<Probe />);
    const options = mockUseQuery.mock.calls[0]?.[0] as QueryOptions;

    await expect(options.queryFn()).rejects.toThrow('receipt list failed');
  });

  it('scopes receipt detail prefetches to the current authenticated user and merchant', async () => {
    const { receiptDetailQueryOptions } = await import('@/hooks/use-receipts');
    mockSingle.mockResolvedValue({
      data: {
        amount_paid: 95000,
        created_at: '2026-05-24T10:00:00.000Z',
        currency: 'NGN',
        customer_email: 'ada@example.com',
        customer_name: 'Ada',
        customer_phone: null,
        discount_amount: 0,
        id: 'order-1',
        is_credit_order: false,
        notes: null,
        order_items: [],
        order_number: 'OG-1001',
        payment_method: null,
        payment_status: 'paid',
        shipping_address: null,
        shipping_fee: 0,
        subtotal: 95000,
        tax_amount: 0,
        total: 95000,
      },
      error: null,
    });

    const options = receiptDetailQueryOptions('order-1') as QueryOptions;
    await options.queryFn();

    expect(options).toEqual(
      expect.objectContaining({
        queryKey: ['receipt-detail', 'order-1', 'auth-user-1', 'merchant-1'],
      })
    );
    expect(mockQueryBuilder.select).toHaveBeenCalledWith(
      expect.stringContaining('customers!inner')
    );
    expect(mockQueryBuilder.eq).toHaveBeenCalledWith('id', 'order-1');
    expect(mockQueryBuilder.eq).toHaveBeenCalledWith(
      'merchant_id',
      'merchant-1'
    );
    expect(mockQueryBuilder.eq).toHaveBeenCalledWith(
      'customers.user_id',
      'auth-user-1'
    );
  });

  it('requires user and merchant scope for receipt detail prefetches', async () => {
    const { receiptDetailQueryOptions } = await import('@/hooks/use-receipts');

    await expect(
      (
        receiptDetailQueryOptions('order-1', {
          merchantId: 'merchant-1',
          userId: null,
        }) as QueryOptions
      ).queryFn()
    ).rejects.toThrow('Authentication required to load receipt');
    await expect(
      (
        receiptDetailQueryOptions('order-1', {
          merchantId: null,
          userId: 'auth-user-1',
        }) as QueryOptions
      ).queryFn()
    ).rejects.toThrow('Authentication required to load receipt');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('propagates receipt detail Supabase errors', async () => {
    const { receiptDetailQueryOptions } = await import('@/hooks/use-receipts');
    mockSingle.mockResolvedValue({
      data: null,
      error: new Error('receipt detail failed'),
    });

    await expect(
      (receiptDetailQueryOptions('order-1') as QueryOptions).queryFn()
    ).rejects.toThrow('receipt detail failed');
  });
});
