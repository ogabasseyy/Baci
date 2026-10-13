import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';

export function getSavingsGoalImageSource(
  goal: WalletActiveSavingsGoal,
  size: number
) {
  if (goal.product_image) {
    return createSafeBoundedImageSource({
      height: size,
      uri: goal.product_image,
      width: size,
    });
  }

  if (__DEV__ && goal.title.trim().toLowerCase() === 'synthetic phone') {
    return require('../../assets/images/synthetic-phone-preview.png') as number;
  }

  return null;
}
