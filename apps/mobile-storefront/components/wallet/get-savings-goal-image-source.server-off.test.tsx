import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { getSavingsGoalImageSource } from './get-savings-goal-image-source';

it('has no source without a product image, so the friendly tile is used', () => {
  const goal = { product_image: null, title: 'Synthetic phone' };
  expect(
    getSavingsGoalImageSource(goal as WalletActiveSavingsGoal, 96)
  ).toBeNull();
});
