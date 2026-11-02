import { fetchWalletTransactions } from './wallet-transaction-data';

const mockFrom = jest.fn();
const mockFilters = jest.fn();
const mockLimit = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

beforeEach(() => {
  jest.clearAllMocks();
  const query = {
    select: () => query,
    eq: (...args: unknown[]) => {
      mockFilters(...args);
      return query;
    },
    order: () => query,
    limit: mockLimit,
  };
  mockFrom.mockReturnValue(query);
});

it('returns normalized history scoped to the owned wallet and merchant', async () => {
  mockLimit.mockResolvedValue({
    data: [
      {
        id: 'tx-1',
        type: 'credit',
        amount: '100',
        description: 'Transfer',
        created_at: '2026-10-12T07:00:00Z',
      },
      { id: 'bad', type: 'credit', amount: 'invalid' },
    ],
    error: null,
  });
  expect(await fetchWalletTransactions('merchant-1', 'wallet-1')).toEqual([
    {
      id: 'tx-1',
      type: 'credit',
      amount: 100,
      description: 'Transfer',
      created_at: '2026-10-12T07:00:00Z',
    },
  ]);
  expect(mockFilters.mock.calls).toEqual([
    ['wallet_id', 'wallet-1'],
    ['merchant_id', 'merchant-1'],
  ]);
  expect(mockLimit).toHaveBeenCalledWith(20);
});

it('does not issue a history request when no wallet exists', async () => {
  expect(await fetchWalletTransactions('merchant-1', undefined)).toEqual([]);
  expect(mockFrom).not.toHaveBeenCalled();
});

it('fails rather than publishing an empty history when the request fails', async () => {
  mockLimit.mockResolvedValue({
    data: null,
    error: new Error('History unavailable'),
  });
  await expect(
    fetchWalletTransactions('merchant-1', 'wallet-1')
  ).rejects.toThrow('History unavailable');
});
