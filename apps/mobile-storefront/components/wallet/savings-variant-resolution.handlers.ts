import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { resolveSavingsGoalVariant } from '@/lib/customer-savings';

interface ResolveSavingsGoalVariantParams {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  goal: WalletActiveSavingsGoal | null;
  refetchWallet: () => Promise<unknown>;
  variantId: string;
}

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

/**
 * Saves the exact option of a completed goal. True when saved, or a message
 * the savings sheet shows inline when it was not (no alerts).
 */
export async function resolveCompletedSavingsGoalVariant({
  activeMerchantId,
  activeMerchantSlug,
  goal,
  refetchWallet,
  variantId,
}: ResolveSavingsGoalVariantParams): Promise<true | string> {
  const eligibleVariant = goal?.variant_resolution_options?.find(
    (option) => option.id === variantId
  );
  if (
    goal?.status !== 'completed' ||
    !goal.selection_unresolved ||
    !eligibleVariant
  ) {
    return 'That option is no longer available. Pull to refresh and try again.';
  }

  try {
    await resolveSavingsGoalVariant({
      goalId: goal.id,
      merchantId: activeMerchantId,
      merchantSlug: activeMerchantSlug,
      variantId,
    });
    // The choice is saved. Refresh so the goal stops asking for it; if two
    // tries fail, say it is saved rather than leaving the old question up.
    for (let tries = 0; tries < 2; tries += 1) {
      try {
        await refetchWallet();
        return true;
      } catch {
        // try once more
      }
    }
    return 'Your choice is saved. Pull down on the wallet to refresh it.';
  } catch (error) {
    await refetchWallet().catch(() => undefined);
    return error instanceof Error && error.message
      ? error.message
      : 'This savings goal changed. Pull to refresh to see where it stands.';
  }
}
