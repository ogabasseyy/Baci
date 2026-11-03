import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type QueryOptions = {
  enabled?: boolean;
  queryFn: () => Promise<unknown>;
};

type RpcResult = {
  data: unknown;
  error: Error | null;
};

const mockWithSupabaseRetry = jest.fn(
  async (callback: () => Promise<unknown>) => callback()
);
const mockAuthState = {
  merchantId: 'merchant-1',
  user: { id: 'auth-user-1' },
};
const mockOrder = jest.fn<() => Promise<RpcResult>>();
const mockSingle = jest.fn<() => Promise<RpcResult>>();
const mockLimit = jest.fn<() => Promise<RpcResult>>();
const mockQueryBuilder = {
  eq: jest.fn((_field: string, _value: string) => mockQueryBuilder),
  limit: mockLimit,
  order: mockOrder,
  select: jest.fn((_columns: string) => mockQueryBuilder),
  single: mockSingle,
};
const mockFrom = jest.fn((_table: string) => mockQueryBuilder);
const mockRpc = jest.fn(
  async (_fn: string, _args?: unknown): Promise<RpcResult> => ({
    data: [],
    error: null,
  })
);
const mockUseAuthStore = Object.assign(
  jest.fn((selector: (state: typeof mockAuthState) => unknown) =>
    selector(mockAuthState)
  ),
  {
    getState: jest.fn(() => mockAuthState),
  }
);

jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => options,
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

// biome-ignore format: compact fixture mirrors use-receipt-detail.test.tsx.
const paidManualOrder = () => ({ id: 'order-9', order_number: 'OG-9', created_at: '2026-05-24T10:00:00.000Z', currency: 'NGN', customer_email: 'ada@example.com', customer_name: 'Ada', customer_phone: null, discount_amount: 0, is_credit_order: false, notes: null, order_items: [{ id: 'item-1', name: 'Phone', quantity: 1, price: 100 }], payment_method: null, payment_status: 'paid', shipping_status: 'processing', shipping_address: null, shipping_fee: 0, subtotal: 100, tax_amount: 0, total: 100, amount_paid: 100, recorded_by_user_id: 'staff-1', import_job_id: null, external_source: null });

describe('receipt detail RPC parallelism', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrder.mockResolvedValue({ data: [], error: null });
    mockSingle.mockResolvedValue({ data: paidManualOrder(), error: null });
    mockLimit.mockResolvedValue({ data: [], error: null });
  });

  // biome-ignore format: compact gates preserve the 300-line gate.
  it('issues the account and transaction RPCs without awaiting each other', async () => {
    const { receiptDetailQueryOptions } = await import('@/hooks/use-receipts');
    let resolveAccounts!: (result: RpcResult) => void;
    let resolveTransactions!: (result: RpcResult) => void;
    const accountsGate = new Promise<RpcResult>((resolve) => { resolveAccounts = resolve; });
    const transactionsGate = new Promise<RpcResult>((resolve) => { resolveTransactions = resolve; });
    mockRpc.mockImplementation(async (fn: string) => {
      if (fn === 'get_customer_order_payment_accounts') return accountsGate;
      if (fn === 'get_customer_order_transactions') return transactionsGate;
      return { data: [], error: null };
    });
    const pending = (receiptDetailQueryOptions('order-9') as QueryOptions).queryFn();
    for (let i = 0; i < 50; i++) { await new Promise((resolve) => setTimeout(resolve, 0)); const names = mockRpc.mock.calls.map((call) => call[0] as string); if (names.includes('get_customer_order_payment_accounts') && names.includes('get_customer_order_transactions')) break; }
    const names = mockRpc.mock.calls.map((call) => call[0] as string);
    expect(names).toContain('get_customer_order_payment_accounts');
    expect(names).toContain('get_customer_order_transactions');
    resolveAccounts({ data: [], error: null });
    resolveTransactions({ data: [], error: null });
    const detail = (await pending) as { transactions: unknown[] } | null;
    expect(detail?.transactions).toEqual([]);
  });
});
