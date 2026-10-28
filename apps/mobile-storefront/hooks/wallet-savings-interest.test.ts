import { fetchWalletSavingsInterest } from './wallet-savings-interest';

const merchantId = '40000000-0000-4000-8000-000000000004';
const mockRpc = jest.fn();
const mockFetchWalletSavingsEarnings = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

jest.mock('./wallet-savings-earnings', () => ({
  fetchWalletSavingsEarnings: (...args: unknown[]) =>
    mockFetchWalletSavingsEarnings(...args),
}));

beforeEach(() => {
  mockRpc.mockReset();
  mockFetchWalletSavingsEarnings.mockReset();
});

it('loads earnings and history from one validated snapshot RPC', async () => {
  mockRpc.mockResolvedValueOnce({
    data: {
      credited_interest_kobo: 733,
      goal_interest_kobo: [],
      interest_history: [
        {
          id: 'primary-reversal:integration:reversal-1',
          goal_id: '50000000-0000-4000-8000-000000000005',
          amount: -1.25,
          type: 'adjustment',
          description: 'Paid savings interest reversal',
          source_type: 'savings_interest',
          created_at: null,
        },
      ],
    },
    error: null,
  });

  const result = await fetchWalletSavingsInterest(merchantId);
  expect(result).toMatchObject({
    status: 'available',
    creditedInterestKobo: 733,
    transactions: [{ amount: -1.25, created_at: null }],
  });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRpc).toHaveBeenCalledWith(
    'get_customer_savings_interest_snapshot',
    { p_merchant_id: merchantId }
  );
});

it('preserves oversized interest history rows with an unavailable amount', async () => {
  mockRpc.mockResolvedValueOnce({
    data: {
      credited_interest_kobo: 733,
      goal_interest_kobo: [],
      interest_history: [
        {
          id: 'interest:oversized',
          goal_id: '50000000-0000-4000-8000-000000000005',
          amount: Number.MAX_SAFE_INTEGER,
          type: 'credit',
          description: 'Savings interest credited',
          source_type: 'savings_interest',
          created_at: '2026-10-13T08:00:00Z',
        },
      ],
    },
    error: null,
  });
  await expect(fetchWalletSavingsInterest(merchantId)).resolves.toMatchObject({
    status: 'available',
    transactions: [{ id: 'interest:oversized', amount: null }],
  });
});

it('preserves validated history while marking unsafe earnings unavailable', async () => {
  const history = [
    {
      id: 'primary-reversal:integration:reversal-1',
      goal_id: '50000000-0000-4000-8000-000000000005',
      amount: -1.25,
      type: 'adjustment',
      description: 'Paid savings interest reversal',
      source_type: 'savings_interest',
      created_at: null,
    },
  ];
  mockRpc.mockResolvedValueOnce({
    data: {
      earnings_available: false,
      credited_interest_kobo: null,
      goal_interest_kobo: [],
      interest_history: history,
    },
    error: null,
  });

  await expect(fetchWalletSavingsInterest(merchantId)).resolves.toMatchObject({
    status: 'history-only',
    creditedInterestKobo: null,
    goalInterestKobo: [],
    transactions: history,
  });
});

it('uses the one-argument RPC when the goals overload is absent', async () => {
  mockRpc
    .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
    .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
    .mockResolvedValueOnce({
      data: { credited_interest_kobo: 733 },
      error: null,
    });
  mockFetchWalletSavingsEarnings.mockResolvedValue({
    earnings_available: true,
    earnings_balance: 7.33,
  });

  const result = await fetchWalletSavingsInterest(merchantId);
  expect(result).toMatchObject({
    status: 'available',
    creditedInterestKobo: 733,
    goalInterestKobo: [],
  });
  expect(result.transactions).toBeUndefined();
  expect(mockRpc).toHaveBeenCalledTimes(3);
  expect(mockRpc).toHaveBeenNthCalledWith(3, 'get_customer_savings_earnings', {
    p_merchant_id: merchantId,
  });
  expect(mockFetchWalletSavingsEarnings).not.toHaveBeenCalled();
});

it('uses the legacy helper if both earnings RPC signatures are unavailable', async () => {
  mockRpc
    .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
    .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
    .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } });
  mockFetchWalletSavingsEarnings.mockResolvedValue({
    earnings_available: true,
    earnings_balance: 7.33,
  });
  await expect(fetchWalletSavingsInterest(merchantId)).resolves.toMatchObject({
    status: 'available',
    creditedInterestKobo: 733,
  });
  expect(mockRpc).toHaveBeenCalledTimes(3);
  expect(mockRpc).toHaveBeenNthCalledWith(3, 'get_customer_savings_earnings', {
    p_merchant_id: merchantId,
  });
  expect(mockFetchWalletSavingsEarnings).toHaveBeenCalledWith(merchantId);
});

it.each([
  'PGRST202',
  '42883',
])('uses the legacy RPC for missing-overload code %s', async (code) => {
  mockRpc
    .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
    .mockResolvedValue({ data: null, error: { code } });
  mockFetchWalletSavingsEarnings.mockResolvedValue({
    earnings_available: true,
    earnings_balance: 0.12,
  });

  await expect(fetchWalletSavingsInterest(merchantId)).resolves.toMatchObject({
    status: 'available',
    creditedInterestKobo: 12,
  });
  expect(mockFetchWalletSavingsEarnings).toHaveBeenCalledWith(merchantId);
});

it('does not hide unrelated RPC failures behind the legacy overload', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { code: '42501' } });

  await expect(fetchWalletSavingsInterest(merchantId)).resolves.toMatchObject({
    status: 'unavailable',
    creditedInterestKobo: null,
  });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockFetchWalletSavingsEarnings).not.toHaveBeenCalled();
});

it('reports an unconfigured database environment as unavailable without legacy fallback', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { code: '55000' } });

  await expect(fetchWalletSavingsInterest(merchantId)).resolves.toMatchObject({
    status: 'unavailable',
    creditedInterestKobo: null,
  });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockFetchWalletSavingsEarnings).not.toHaveBeenCalled();
});

it('returns earnings only when the snapshot RPC is unavailable', async () => {
  mockRpc
    .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } })
    .mockResolvedValueOnce({
      data: { credited_interest_kobo: 733, goal_interest_kobo: [] },
      error: null,
    });

  const result = await fetchWalletSavingsInterest(merchantId);
  expect(result).toMatchObject({
    status: 'available',
    creditedInterestKobo: 733,
  });
  expect(result.transactions).toBeUndefined();
  expect(mockRpc).toHaveBeenCalledTimes(2);
  expect(mockRpc).not.toHaveBeenCalledWith(
    'get_customer_savings_interest_history',
    expect.anything()
  );
});

it('does not call Supabase with an invalid merchant UUID', async () => {
  await expect(fetchWalletSavingsInterest('merchant-1')).resolves.toMatchObject(
    {
      status: 'unavailable',
    }
  );
  expect(mockRpc).not.toHaveBeenCalled();
});
