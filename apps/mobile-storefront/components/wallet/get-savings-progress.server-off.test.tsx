import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { getSavingsProgress } from './get-savings-progress';

it('keeps truthful progress available while storefront savings are server-off', () => {
  const goal = {
    current_amount: 99999,
    target_amount: 100000,
  } as WalletActiveSavingsGoal;

  expect(getSavingsProgress(goal)).toEqual({
    milestone: 'Almost there',
    percent: 99,
  });
});
