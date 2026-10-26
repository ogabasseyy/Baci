import { WalletNumberGoalsSchema } from '@/schemas/wallet-number-goals';
import { walletGoalMetadata } from './wallet-goal-metadata';
import { fetchWalletNumbers } from './wallet-number-data';

const mockFrom = jest.fn();
const mockInterest = jest.fn();
const calls: Record<string, { columns: string[]; filters: unknown[][] }> = {};
let responses: Record<string, { data: unknown; error: unknown }>;
const rawGoal = {
  id: 'goal-1',
  current_amount: '200',
  target_amount: '1000',
  product_id: 'product-1',
  variant_id: 'variant-1',
  title: 'Phone',
  product_snapshot: { storage: '128GB' },
  contribution_amount: '100',
  contribution_frequency: 'monthly',
  source_mode: 'manual',
  status: 'active',
  maturity_date: '2026-11-01',
};
jest.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));
jest.mock('@/services/analytics', () => ({ trackEvent: jest.fn() }));
jest.mock('./wallet-savings-interest', () => ({
  fetchWalletSavingsInterest: (...args: unknown[]) => mockInterest(...args),
  toWalletSavingsInterestEarnings: (interest: {
    creditedInterestKobo: number;
  }) => ({
    earnings_available: true,
    earnings_balance: interest.creditedInterestKobo / 100,
  }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  for (const table of Object.keys(calls)) delete calls[table];
  responses = {
    customers: {
      data: [{ id: 'customer-1', loyalty_points: 10 }],
      error: null,
    },
    customer_wallets: { data: { available_balance: '100' }, error: null },
    customer_savings_goals: {
      data: [rawGoal],
      error: null,
    },
  };
  mockInterest.mockResolvedValue({
    status: 'available',
    creditedInterestKobo: 505,
    goalInterestKobo: [{ goal_id: 'goal-1', credited_interest_kobo: 505 }],
  });
  mockFrom.mockImplementation((table: string) => {
    calls[table] = { columns: [], filters: [] };
    const query = {
      select: (columns: string) => {
        calls[table].columns.push(columns);
        return query;
      },
      eq: (...args: unknown[]) => {
        calls[table].filters.push(args);
        return query;
      },
      in: async () => responses[table],
      limit: async () => responses[table],
      maybeSingle: async () => responses[table],
    };
    return query;
  });
});

it('reads only scoped numeric projections and includes paid interest exactly once in progress and totals', async () => {
  const result = await fetchWalletNumbers('customer-1', 'merchant-1', 'user-1');
  expect(result).toMatchObject({
    wallet: {
      balance: 100,
      savings_balance: 205.05,
      total_balance: 305.05,
      earnings_balance: 5.05,
      loyalty_points: 10,
    },
    goals: [{ id: 'goal-1', current_amount: 205.05 }],
  });
  const fullLoadMetadata = walletGoalMetadata(rawGoal);
  expect(result?.goals[0]?.metadata).toBe(fullLoadMetadata);
  expect(WalletNumberGoalsSchema.parse(result?.goals)[0]?.metadata).toBe(
    fullLoadMetadata
  );
  expect(Object.keys(calls)).toEqual([
    'customers',
    'customer_wallets',
    'customer_savings_goals',
  ]);
  expect(calls.customer_wallets.columns).toEqual(['available_balance']);
  expect(calls.customer_savings_goals.columns).toEqual([
    'id, current_amount, target_amount, product_id, variant_id, title, product_snapshot, contribution_amount, contribution_frequency, source_mode, status, maturity_date',
  ]);
  for (const table of ['customer_wallets', 'customer_savings_goals']) {
    expect(calls[table].filters).toEqual([
      ['merchant_id', 'merchant-1'],
      ['customer_id', 'customer-1'],
    ]);
  }
  expect(mockInterest).toHaveBeenCalledWith('merchant-1');
});

it('returns a fallback marker without reading another customer when owner resolution fails', async () => {
  responses.customers.data = [];
  expect(await fetchWalletNumbers(null, 'merchant-1', 'user-1')).toBeNull();
  expect(Object.keys(calls)).toEqual(['customers']);
});

it.each([
  'customer_wallets',
  'customer_savings_goals',
])('propagates %s read errors', async (table) => {
  responses[table].error = new Error('Offline');
  await expect(
    fetchWalletNumbers('customer-1', 'merchant-1', 'user-1')
  ).rejects.toThrow('Offline');
});

it('does not replace paid-interest-inclusive savings with principal alone when interest cannot be refreshed', async () => {
  mockInterest.mockResolvedValue({
    status: 'unavailable',
    creditedInterestKobo: null,
    goalInterestKobo: [],
  });
  await expect(
    fetchWalletNumbers('customer-1', 'merchant-1', 'user-1')
  ).rejects.toThrow('Could not refresh savings interest');
});

it('rejects a malformed wallet amount rather than displaying a fresh zero', async () => {
  responses.customer_wallets.data = { available_balance: 'invalid' };
  await expect(
    fetchWalletNumbers('customer-1', 'merchant-1', 'user-1')
  ).rejects.toThrow('Invalid wallet balance');
});
