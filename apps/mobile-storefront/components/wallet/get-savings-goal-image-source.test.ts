import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { getSavingsGoalImageSource } from './get-savings-goal-image-source';

const goal = {
  title: 'Synthetic phone',
  product_image: null,
} as WalletActiveSavingsGoal;

it('returns no source for a goal without a product image', () => {
  expect(getSavingsGoalImageSource(goal, 128)).toBeNull();
});

it('uses the catalog image when there is one', () => {
  const source = getSavingsGoalImageSource(
    { ...goal, product_image: 'https://example.com/phone.jpg' },
    128
  );
  expect(source).toHaveProperty('uri');
});
