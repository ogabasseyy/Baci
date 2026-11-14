import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import type { Product } from '@/types/product';
import {
  changeSavingsGoalDevice,
  createSavingsVariantResolutionHandler,
} from './wallet-screen-savings.handlers';

interface SavingsGoalContentHandlersInput {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  goal: WalletActiveSavingsGoal | null;
  refetchWallet: () => Promise<unknown>;
}

/**
 * The two goal-editing callbacks WalletContent receives, bound to the
 * active goal. Kept out of WalletScreen so that file stays under the
 * 300-line limit.
 */
export function createSavingsGoalContentHandlers(
  input: SavingsGoalContentHandlersInput
) {
  return {
    onChangeSavingsDevice: (product: Product, variantId?: string | null) =>
      changeSavingsGoalDevice({ ...input, product, variantId }),
    onResolveSavingsVariant: createSavingsVariantResolutionHandler(input),
  };
}
