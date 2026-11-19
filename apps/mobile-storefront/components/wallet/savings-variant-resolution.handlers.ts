import {
  type ResolveSavingsGoalVariantParams,
  resolveCompletedSavingsGoalVariant,
} from './resolve-completed-savings-goal-variant';

/** The savings sheet's "Confirm this option" handler for the goal on screen. */
export function createSavingsVariantResolutionHandler({
  activeMerchantId,
  activeMerchantSlug,
  goal,
  refetchWallet,
}: Omit<ResolveSavingsGoalVariantParams, 'variantId'>) {
  return async (variantId: string) =>
    await resolveCompletedSavingsGoalVariant({
      activeMerchantId,
      activeMerchantSlug,
      goal,
      refetchWallet,
      variantId,
    });
}
