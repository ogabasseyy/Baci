import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { getSavingsGoalImageSource } from './get-savings-goal-image-source';

const goal = {
  title: 'Synthetic phone',
  product_image: null,
} as WalletActiveSavingsGoal;

it('uses a local render only for the synthetic test device in development', () => {
  expect(getSavingsGoalImageSource(goal, 128)).not.toBeNull();
  expect(
    getSavingsGoalImageSource({ ...goal, title: 'Real phone' }, 128)
  ).toBeNull();
});

it('uses the catalog image ahead of the synthetic preview', () => {
  const source = getSavingsGoalImageSource(
    { ...goal, product_image: 'https://example.com/phone.jpg' },
    128
  );
  expect(source).toHaveProperty('uri');
});

it('never returns the synthetic render in a release build', () => {
  const originalDev = __DEV__;
  Object.defineProperty(globalThis, '__DEV__', { value: false });
  try {
    expect(getSavingsGoalImageSource(goal, 128)).toBeNull();
  } finally {
    Object.defineProperty(globalThis, '__DEV__', { value: originalDev });
  }
});
