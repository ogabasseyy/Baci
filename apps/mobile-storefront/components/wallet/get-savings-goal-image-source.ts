import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { PRODUCT_PLACEHOLDER_IMAGE } from '@/lib/product-normalization';
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';

export function getSavingsGoalImageSource(
  goal: WalletActiveSavingsGoal,
  size: number
) {
  if (goal.product_image && goal.product_image !== PRODUCT_PLACEHOLDER_IMAGE) {
    return createSafeBoundedImageSource({
      height: size,
      uri: goal.product_image,
      width: size,
    });
  }

  return null;
}
