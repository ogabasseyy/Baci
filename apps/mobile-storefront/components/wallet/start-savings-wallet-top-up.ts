import { fundWallet } from './wallet-screen.handlers';

type SavingsWalletTopUpParams = Omit<
  Parameters<typeof fundWallet>[0],
  'resetFundPanel' | 'walletReturnTo'
> & { goalId: string };

export function startSavingsWalletTopUp({
  goalId,
  ...funding
}: SavingsWalletTopUpParams) {
  const walletReturnTo = `/wallet?action=savings&savingsGoalId=${encodeURIComponent(goalId)}&savingsAmount=${encodeURIComponent(funding.fundAmount)}`;
  return fundWallet({
    ...funding,
    resetFundPanel: () => undefined,
    walletReturnTo,
  });
}
