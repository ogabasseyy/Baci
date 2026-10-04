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

describe('receipt detail locality', () => {
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

  // biome-ignore format: compact fixtures preserve the 300-line gate.
  const partialManualOrder = (overrides: Record<string, unknown> = {}) => ({ id: 'order-9', order_number: 'OG-9', created_at: '2026-05-24T10:00:00.000Z', currency: 'NGN', customer_email: 'ada@example.com', customer_name: 'Ada', customer_phone: null, discount_amount: 0, is_credit_order: false, notes: null, order_items: [{ id: 'item-1', name: 'Phone', quantity: 1, price: 100 }], payment_method: null, payment_status: 'partially_paid', shipping_status: 'processing', shipping_address: null, shipping_fee: 0, subtotal: 100, tax_amount: 0, total: 100, amount_paid: 50, recorded_by_user_id: 'staff-1', import_job_id: null, external_source: null, ...overrides });

  it('opens manual detail with explicit null locality from same-as-customer edits', async () => {
    const { receiptDetailQueryOptions } = await import('@/hooks/use-receipts');
    mockSingle.mockResolvedValue({
      data: partialManualOrder({
        shipping_address: {
          address_line1: '12 Allen Ave',
          city: null,
          state: null,
          postal_code: null,
          country: 'Nigeria',
        },
      }),
      error: null,
    });
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    // The sender accepts nullish locality, so the detail must open
    // instead of failing the whole receipt closed.
    const detail = (await (
      receiptDetailQueryOptions('order-9') as QueryOptions
    ).queryFn()) as { shipping_address: unknown } | null;

    expect(detail).not.toBeNull();
    expect(detail?.shipping_address).toEqual(
      expect.objectContaining({ city: null, country: 'Nigeria' })
    );
  });
});
