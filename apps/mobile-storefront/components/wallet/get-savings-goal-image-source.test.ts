import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { PRODUCT_PLACEHOLDER_IMAGE } from '@/lib/product-normalization';
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

it('uses device artwork for the catalogue placeholder instead of a No Image tile', () => {
  expect(
    getSavingsGoalImageSource(
      { ...goal, product_image: PRODUCT_PLACEHOLDER_IMAGE },
      128
    )
  ).toBeNull();
});
