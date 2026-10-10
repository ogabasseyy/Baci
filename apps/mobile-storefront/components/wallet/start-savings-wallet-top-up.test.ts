import { startSavingsWalletTopUp } from './start-savings-wallet-top-up';
import { fundWallet } from './wallet-screen.handlers';

jest.mock('./wallet-screen.handlers', () => ({ fundWallet: jest.fn() }));

describe('startSavingsWalletTopUp', () => {
  beforeEach(() => jest.clearAllMocks());

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
