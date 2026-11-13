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

// With PiggyVest off the interest read fails or falls back: per-goal interest
// is then never claimed as known, so no review shows a split it can't back.
describe('wallet savings interest with the server off', () => {
  it('marks per-goal interest known only when the server sent it', async () => {
    mockRpc.mockResolvedValue({
      data: { credited_interest_kobo: 0, goal_interest_kobo: [] },
      error: null,
    });
    await expect(fetchWalletSavingsInterest(merchantId)).resolves.toMatchObject(
      { status: 'available', goalInterestKnown: true }
    );
  });

  it('never claims per-goal interest from the legacy total-only read', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    mockFetchWalletSavingsEarnings.mockResolvedValue({
      earnings_available: true,
      earnings_balance: 7.33,
    });
    await expect(fetchWalletSavingsInterest(merchantId)).resolves.toMatchObject(
      { status: 'available', goalInterestKnown: false }
    );
  });

  it('never claims it when the read fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '500' } });
    await expect(fetchWalletSavingsInterest(merchantId)).resolves.toMatchObject(
      { status: 'unavailable', goalInterestKnown: false }
    );
  });
});
