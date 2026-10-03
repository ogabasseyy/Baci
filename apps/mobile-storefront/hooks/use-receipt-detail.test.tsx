import { beforeEach, describe, expect, it, jest } from '@jest/globals';

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

describe('receipt detail loading', () => {
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

  it('projects item descriptions and SKUs like the emailed PDF input', async () => {
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
        order_items: [
          {
            id: 'item-1',
            name: 'Phone',
            quantity: 1,
            price: 95000,
            item_description: 'Midnight 128GB',
            sellers_item_id: 'SKU-1',
          },
        ],
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
    const detail = (await options.queryFn()) as {
      items: Array<{
        product_name: string;
        description?: string;
        sellers_item_id?: string;
      }>;
    };

    // Without these the app link opens a document missing descriptions
    // and SKU labels the attachment shows.
    expect(mockQueryBuilder.select).toHaveBeenCalledWith(
      expect.stringContaining('item_description')
    );
    expect(mockQueryBuilder.select).toHaveBeenCalledWith(
      expect.stringContaining('sellers_item_id')
    );
    expect(detail.items[0]).toEqual(
      expect.objectContaining({
        product_name: 'Phone',
        description: 'Midnight 128GB',
        sellers_item_id: 'SKU-1',
      })
    );
  });

  // biome-ignore format: compact fixtures preserve the 300-line gate.
  const partialManualOrder = (overrides: Record<string, unknown> = {}) => ({ id: 'order-9', order_number: 'OG-9', created_at: '2026-05-24T10:00:00.000Z', currency: 'NGN', customer_email: 'ada@example.com', customer_name: 'Ada', customer_phone: null, discount_amount: 0, is_credit_order: false, notes: null, order_items: [{ id: 'item-1', name: 'Phone', quantity: 1, price: 100 }], payment_method: null, payment_status: 'partially_paid', shipping_status: 'processing', shipping_address: null, shipping_fee: 0, subtotal: 100, tax_amount: 0, total: 100, amount_paid: 50, recorded_by_user_id: 'staff-1', import_job_id: null, external_source: null, ...overrides });

  it('fails a partial manual invoice closed when history is unavailable', async () => {
    const { receiptDetailQueryOptions } = await import('@/hooks/use-receipts');
    mockSingle.mockResolvedValue({ data: partialManualOrder(), error: null });
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('tx down') });

    await expect(
      (receiptDetailQueryOptions('order-9') as QueryOptions).queryFn()
    ).rejects.toThrow('tx down');
  });

  it('opens zero-progress manual invoices with empty history', async () => {
    const { receiptDetailQueryOptions } = await import('@/hooks/use-receipts');
    mockSingle.mockResolvedValue({
      data: partialManualOrder({ amount_paid: 0 }),
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('tx down') });

    const detail = (await (
      receiptDetailQueryOptions('order-9') as QueryOptions
    ).queryFn()) as { transactions: unknown[] };

    expect(detail.transactions).toEqual([]);
  });

  it('opens paid-label-but-unsettled manual rows despite history errors', async () => {
    const { receiptDetailQueryOptions } = await import('@/hooks/use-receipts');
    mockSingle.mockResolvedValue({
      data: partialManualOrder({ payment_status: 'paid' }),
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('tx down') });

    const detail = (await (
      receiptDetailQueryOptions('order-9') as QueryOptions
    ).queryFn()) as { transactions: unknown[] };

    expect(detail.transactions).toEqual([]);
  });
});
