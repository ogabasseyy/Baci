import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fetchWalletSavingsEarnings } from './wallet-savings-earnings';

type RpcResult = {
  data: unknown;
  error: unknown;
};

const mockRpc = jest.fn<(...args: unknown[]) => Promise<RpcResult>>();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

describe('fetchWalletSavingsEarnings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('converts a settled credited-interest kobo amount to naira', async () => {
    mockRpc.mockResolvedValue({
      data: { credited_interest_kobo: 12_550 },
      error: null,
    });

    await expect(fetchWalletSavingsEarnings('merchant-1')).resolves.toEqual({
      earnings_available: true,
      earnings_balance: 125.5,
    });
    expect(mockRpc).toHaveBeenCalledWith('get_customer_savings_earnings', {
      p_merchant_id: 'merchant-1',
    });
  });

  it('keeps earnings unavailable when the RPC fails or rejects', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202' },
    });
    await expect(fetchWalletSavingsEarnings('merchant-1')).resolves.toEqual({
      earnings_available: false,
      earnings_balance: null,
    });

    mockRpc.mockRejectedValueOnce(new Error('Network unavailable'));
    await expect(fetchWalletSavingsEarnings('merchant-1')).resolves.toEqual({
      earnings_available: false,
      earnings_balance: null,
    });
  });
  it('shows the provider sample net payout as ₦7.33, not gross interest or kobo', async () => {
    mockRpc.mockResolvedValue({
      data: { credited_interest_kobo: 733 },
      error: null,
    });

    await expect(fetchWalletSavingsEarnings('merchant-1')).resolves.toEqual({
      earnings_available: true,
      earnings_balance: 7.33,
    });
  });
});
