import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fetchWalletData } from './wallet-data';

type QueryResult = {
  data: unknown;
  error: unknown;
};

const mockFrom = jest.fn<(table: string) => unknown>();
const mockRpc = jest.fn<(...args: unknown[]) => unknown>();
const mockVariantRange = jest.fn<() => Promise<unknown>>();
const mockTrackEvent = jest.fn();

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

const mockReadPrimary = jest.fn<() => Promise<unknown>>();
jest.mock('./resolve-wallet-funding-account', () => {
  const actual = jest.requireActual(
    './resolve-wallet-funding-account'
  ) as typeof import('./resolve-wallet-funding-account');
  return {
    ...actual,
    readPrimaryFundingAccount: () => mockReadPrimary(),
  };
});

function createResult(data: unknown, error: unknown = null): QueryResult {
  return { data, error };
}

function setupSupabaseTables(
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
        if (typeof columns === 'string') {
          selectCalls[table].push(columns);
        }
        return query;
      }),
    };
    return query;
  });

  return { selectCalls, tableCalls };
}

describe('fetchWalletData with PiggyVest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadPrimary.mockResolvedValue({ status: 'unavailable' });
  });

  describe('PiggyVest primary balance', () => {
    const readyAccount = {
      accountName: 'Verified',
      accountNumber: '0987654321',
      bankName: 'Provider Bank',
      provider: 'piggyvest',
    };

    it('exposes the ready balance in kobo and leaves the legacy balance untouched', async () => {
      setupSupabaseTables();
      mockReadPrimary.mockResolvedValue({
        status: 'ready',
        account: readyAccount,
        balanceKobo: 123456,
      });
      const { wallet } = await fetchWalletData(
        'customer-1',
        'merchant-1',
        'user-1'
      );
      expect(wallet.primary_balance_kobo).toBe(123456);
      expect(wallet.balance).toBe(5000);
      expect(wallet.total_balance).toBe(5000);
    });

    it.each([
      ['not ready', { status: 'not_ready' }],
      ['unavailable (error or identity switch)', { status: 'unavailable' }],
      [
        'pending (no account)',
        { status: 'ready', account: null, balanceKobo: null },
      ],
    ])('adds no primary balance when %s', async (_label, settled) => {
      setupSupabaseTables();
      mockReadPrimary.mockResolvedValue(settled);
      const { wallet } = await fetchWalletData(
        'customer-1',
        'merchant-1',
        'user-1'
      );
      expect('primary_balance_kobo' in wallet).toBe(false);
      expect(wallet.balance).toBe(5000);
    });
  });
});
