import { fetchWalletData } from './wallet-data';

const mockFrom = jest.fn();
const mockPrimary = jest.fn();
const mockInterest = jest.fn();
const mockProducts = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));
jest.mock('@/services/analytics', () => ({ trackEvent: jest.fn() }));
jest.mock('./resolve-wallet-funding-account', () => ({
  readPrimaryFundingAccount: (...args: unknown[]) => mockPrimary(...args),
  resolveWalletFundingAccount: () => null,
}));
jest.mock('./wallet-savings-interest', () => ({
  fetchWalletSavingsInterest: (...args: unknown[]) => mockInterest(...args),
  toWalletSavingsInterestEarnings: () => ({
    earnings_available: false,
    earnings_balance: null,
  }),
}));
jest.mock('./wallet-savings-product-hydration', () => ({
  hydrateWalletSavingsProducts: (...args: unknown[]) => mockProducts(...args),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function flushRequests() {
  for (let step = 0; step < 20; step++) await Promise.resolve();
}

function setupTables(wallet: Promise<unknown>) {
  const queries: Record<string, unknown> = {
    customers: Promise.resolve({
      data: [{ id: 'customer-1', loyalty_points: 10 }],
      error: null,
    }),
    customer_wallets: wallet,
    customer_wallet_payment_accounts: Promise.resolve({
      data: null,
      error: null,
    }),
    customer_savings_goals: Promise.resolve({ data: [], error: null }),
    customer_wallet_transactions: Promise.resolve({ data: [], error: null }),
  };
  mockFrom.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      maybeSingle: () => queries[table],
      limit: () => queries[table],
      order: () =>
        table === 'customer_savings_goals' ? queries[table] : query,
    };
    return query;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrimary.mockResolvedValue({ status: 'unavailable' });
  mockInterest.mockResolvedValue({
    status: 'unavailable',
    creditedInterestKobo: null,
    goalInterestKobo: [],
  });
  mockProducts.mockResolvedValue(new Map());
});

it('starts independent owned reads and product hydration before a slow wallet read finishes', async () => {
  const wallet = deferred<unknown>();
  setupTables(wallet.promise);
  const pending = fetchWalletData('customer-1', 'merchant-1', 'user-1');
  await flushRequests();

  const started = {
    primary: mockPrimary.mock.calls.length,
    interest: mockInterest.mock.calls.length,
    products: mockProducts.mock.calls.length,
  };
  wallet.resolve({
    data: { id: 'wallet-1', available_balance: 100 },
    error: null,
  });
  await pending;

  expect(started).toEqual({ primary: 1, interest: 1, products: 1 });
});

it('loads transaction history while the primary account lookup is still pending', async () => {
  const primary = deferred<unknown>();
  setupTables(
    Promise.resolve({
      data: { id: 'wallet-1', available_balance: 100 },
      error: null,
    })
  );
  mockPrimary.mockReturnValue(primary.promise);
  const pending = fetchWalletData('customer-1', 'merchant-1', 'user-1');
  await flushRequests();

  const requestedHistory = mockFrom.mock.calls.some(
    ([table]) => table === 'customer_wallet_transactions'
  );
  primary.resolve({ status: 'unavailable' });
  const result = await pending;

  expect(requestedHistory).toBe(true);
  expect(result.wallet.total_balance).toBe(100);
});

it('publishes confirmed balances before account, history and product hydration finish', async () => {
  const primary = deferred<unknown>();
  const products = deferred<Map<string, never>>();
  setupTables(
    Promise.resolve({
      data: { id: 'wallet-1', available_balance: 100 },
      error: null,
    })
  );
  mockPrimary.mockReturnValue(primary.promise);
  mockProducts.mockReturnValue(products.promise);
  const onBalances = jest.fn();
  const pending = fetchWalletData('customer-1', 'merchant-1', 'user-1', {
    onBalances,
  });
  await flushRequests();
  const preview = onBalances.mock.calls[0]?.[0];
  primary.resolve({ status: 'unavailable' });
  products.resolve(new Map<string, never>());
  await pending;
  expect(preview).toEqual(
    expect.objectContaining({
      balance: 100,
      total_balance: 100,
      savings_balance: 0,
      loyalty_points: 10,
    })
  );
});

it('does not publish a numeric preview when the wallet read fails', async () => {
  setupTables(Promise.resolve({ data: null, error: new Error('Unavailable') }));
  const onBalances = jest.fn();
  await expect(
    fetchWalletData('customer-1', 'merchant-1', 'user-1', { onBalances })
  ).rejects.toThrow('Unavailable');
  expect(onBalances).not.toHaveBeenCalled();
});
