import { startSavingsWalletTopUp } from './start-savings-wallet-top-up';
import { fundWallet } from './wallet-screen.handlers';

jest.mock('./wallet-screen.handlers', () => ({ fundWallet: jest.fn() }));

// The top-up is a plain wallet funding call and never asks PiggyVest: with the
// server keeping PiggyVest off it behaves like today's production top-up.
describe('server keeps PiggyVest off', () => {
  beforeEach(() => jest.clearAllMocks());

  it('starts nothing without a goal', async () => {
    await startSavingsWalletTopUp({
      fundAmount: '500',
      setIsFundPending: jest.fn(),
    });
    expect(fundWallet).not.toHaveBeenCalled();
  });

  it('hands the legacy wallet top-up the amount and a wallet return path', async () => {
    await startSavingsWalletTopUp({
      fundAmount: '500',
      goalId: 'goal-1',
      setIsFundPending: jest.fn(),
    });
    expect(fundWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        fundAmount: '500',
        walletReturnTo:
          '/wallet?action=savings&savingsGoalId=goal-1&savingsAmount=500',
      })
    );
    expect(fundWallet).toHaveBeenCalledTimes(1);
  });
});
