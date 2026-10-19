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

it('calls the goals overload with a validated merchant UUID', async () => {
  mockRpc.mockResolvedValue({
    data: { credited_interest_kobo: 733, goal_interest_kobo: [] },
    error: null,
  });

  await expect(fetchWalletSavingsInterest(merchantId)).resolves.toMatchObject({
    status: 'available',
    creditedInterestKobo: 733,
  });
  expect(mockRpc).toHaveBeenCalledWith('get_customer_savings_earnings', {
    p_merchant_id: merchantId,
    p_include_goals: true,
  });
});

it('falls back to the one-argument RPC only when the overload is absent', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
  mockFetchWalletSavingsEarnings.mockResolvedValue({
    earnings_available: true,
    earnings_balance: 7.33,
  });

  await expect(fetchWalletSavingsInterest(merchantId)).resolves.toMatchObject({
    status: 'available',
    creditedInterestKobo: 733,
    goalInterestKobo: [],
  });
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockFetchWalletSavingsEarnings).toHaveBeenCalledWith(merchantId);
});

it.each([
  'PGRST202',
  '42883',
])('uses the legacy RPC for missing-overload code %s', async (code) => {
  mockRpc.mockResolvedValue({ data: null, error: { code } });
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

it('does not call Supabase with an invalid merchant UUID', async () => {
  await expect(fetchWalletSavingsInterest('merchant-1')).resolves.toMatchObject(
    {
      status: 'unavailable',
    }
  );
  expect(mockRpc).not.toHaveBeenCalled();
});
