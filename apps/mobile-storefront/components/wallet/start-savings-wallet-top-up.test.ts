import { WALLET_TOP_UP_MIN_AMOUNT } from '@/lib/wallet-top-up-constants';
import { startSavingsWalletTopUp } from './start-savings-wallet-top-up';
import { fundWallet } from './wallet-screen.handlers';

jest.mock('./wallet-screen.handlers', () => ({ fundWallet: jest.fn() }));

describe('startSavingsWalletTopUp', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not start a payment without a selected savings goal', async () => {
    await startSavingsWalletTopUp({
      fundAmount: '500',
      setIsFundPending: jest.fn(),
    });
    expect(fundWallet).not.toHaveBeenCalled();
  });

  it('encodes the goal and amount in the resumable savings destination', async () => {
    const setIsFundPending = jest.fn();
    await startSavingsWalletTopUp({
      fundAmount: '500',
      goalId: 'goal&other=1',
      setIsFundPending,
    });

    expect(fundWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        fundAmount: '500',
        walletReturnTo:
          '/wallet?action=savings&savingsGoalId=goal%26other%3D1&savingsAmount=500',
        setIsFundPending,
      })
    );
  });

  it('tops up at least the wallet minimum while keeping the smaller intended contribution', async () => {
    await startSavingsWalletTopUp({
      fundAmount: '25',
      goalId: 'goal-1',
      setIsFundPending: jest.fn(),
    });

    expect(fundWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        fundAmount: String(WALLET_TOP_UP_MIN_AMOUNT),
        walletReturnTo:
          '/wallet?action=savings&savingsGoalId=goal-1&savingsAmount=25',
      })
    );
  });

  it('leaves a contribution at or above the minimum unchanged', async () => {
    await startSavingsWalletTopUp({
      fundAmount: String(WALLET_TOP_UP_MIN_AMOUNT),
      goalId: 'goal-1',
      setIsFundPending: jest.fn(),
    });

    expect(fundWallet).toHaveBeenCalledWith(
      expect.objectContaining({ fundAmount: String(WALLET_TOP_UP_MIN_AMOUNT) })
    );
  });

  it('propagates initialization failures without clearing the contribution', async () => {
    jest.mocked(fundWallet).mockRejectedValueOnce(new Error('unavailable'));

    await expect(
      startSavingsWalletTopUp({
        fundAmount: '500',
        goalId: 'goal-1',
        setIsFundPending: jest.fn(),
      })
    ).rejects.toThrow('unavailable');
  });
});
