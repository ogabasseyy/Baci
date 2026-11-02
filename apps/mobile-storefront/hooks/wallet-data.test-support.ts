import { jest } from '@jest/globals';

export type QueryResult = {
  data: unknown;
  error: unknown;
};

export const mockFrom = jest.fn<(table: string) => unknown>();
export const mockRpc = jest.fn<(...args: unknown[]) => unknown>();
export const mockVariantRange = jest.fn<() => Promise<unknown>>();
export const mockTrackEvent = jest.fn();

jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (operation: () => Promise<unknown>) => operation(),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

jest.mock('@/services/analytics', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

export const mockReadPrimary = jest.fn<() => Promise<unknown>>();
jest.mock('./resolve-wallet-funding-account', () => {
  const actual = jest.requireActual(
    './resolve-wallet-funding-account'
  ) as typeof import('./resolve-wallet-funding-account');
  return {
    ...actual,
    readPrimaryFundingAccount: () => mockReadPrimary(),
  };
});

export function createResult(
  data: unknown,
  error: unknown = null
): QueryResult {
  return { data, error };
}

export function setupSupabaseTables(
  overrides: Partial<Record<string, QueryResult>> = {}
) {
  const tableResults: Record<string, QueryResult> = {
    customers: createResult([{ id: 'customer-1', loyalty_points: 1200 }]),
    customer_wallet_payment_accounts: createResult(null),
    customer_wallet_transactions: createResult([]),
    customer_wallets: createResult({
      available_balance: '5000',
      id: 'wallet-1',
    }),
    customer_savings_goals: createResult([]),
    products: createResult(null),
    ...overrides,
  };
  const tableCalls: string[] = [];
  const selectCalls: Record<string, string[]> = {};

  // Interest RPC fails by default so tests pin the explicit unavailable
  // marker; success-path tests override per case.
  const interestFailure = {
    data: null,
    error: { code: 'XX000', message: 'synthetic interest outage' },
  };
  mockVariantRange.mockResolvedValue({
    count: 1,
    error: null,
    data: [
      {
        id: 'variant-1',
        product_id: 'product-1',
        condition: 'uk_used',
        sku: 'IPH15P-256',
        attributes: { color: 'Black', storage: '256GB' },
      },
    ],
  });
  mockRpc.mockImplementation((name) => {
    if (name !== 'get_storefront_product_variants')
      return Promise.resolve(interestFailure);
    const query = {
      order: jest.fn(() => query),
      range: () => mockVariantRange(),
    };
    return query;
  });

  mockFrom.mockImplementation((table: string) => {
    tableCalls.push(table);
    selectCalls[table] = [];
    const query = {
      eq: jest.fn(() => query),
      in: jest.fn(() => query),
      limit: jest.fn(async () => tableResults[table]),
      maybeSingle: jest.fn(async () => tableResults[table]),
      order: jest.fn(() =>
        table === 'customer_savings_goals'
          ? Promise.resolve(tableResults[table])
          : query
      ),
      select: jest.fn((columns?: string) => {
        if (typeof columns === 'string') selectCalls[table].push(columns);
        return query;
      }),
    };
    return query;
  });

  return { selectCalls, tableCalls };
}
