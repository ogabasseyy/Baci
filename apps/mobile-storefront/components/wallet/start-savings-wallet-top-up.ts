import { WALLET_TOP_UP_MIN_AMOUNT } from '@/lib/wallet-top-up-constants';
import { fundWallet } from './wallet-screen.handlers';

type SavingsWalletTopUpParams = Omit<
  Parameters<typeof fundWallet>[0],
  'resetFundPanel' | 'walletReturnTo'
> & { goalId?: string };

export function startSavingsWalletTopUp({
  goalId,
  ...funding
}: SavingsWalletTopUpParams) {
  if (!goalId) return Promise.resolve();
  const walletReturnTo = `/wallet?action=savings&savingsGoalId=${encodeURIComponent(goalId)}&savingsAmount=${encodeURIComponent(funding.fundAmount)}`;
  // The wallet rails reject top-ups below their minimum, so a smaller plan
  // balance still funds the minimum; the intended contribution is preserved
  // in the return destination above.
  const intended = Number(funding.fundAmount.trim().replace(/,/g, ''));
  const fundAmount =
    Number.isFinite(intended) &&
    intended > 0 &&
    intended < WALLET_TOP_UP_MIN_AMOUNT
      ? String(WALLET_TOP_UP_MIN_AMOUNT)
      : funding.fundAmount;
  return fundWallet({
    ...funding,
    fundAmount,
    resetFundPanel: () => undefined,
    walletReturnTo,
  });
}
