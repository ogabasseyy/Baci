import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { resolveSavingsGoalVariant } from '@/lib/customer-savings';

/**
 * True when saved and refreshed; `{ saved }` when saved but the wallet could
 * not refresh (the one-time choice must not be sent again); otherwise a
 * message for a choice that was not saved.
 */
export type SavingsVariantResolveResult = true | string | { saved: string };

export interface ResolveSavingsGoalVariantParams {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  goal: WalletActiveSavingsGoal | null;
  refetchWallet: () => Promise<unknown>;
  variantId: string;
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
}: ResolveSavingsGoalVariantParams): Promise<SavingsVariantResolveResult> {
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
        // A failed refresh usually resolves to an error result, not a throw.
        const result = await refetchWallet();
        if (
          !(
            typeof result === 'object' &&
            result &&
            'isError' in result &&
            result.isError
          )
        )
          return true;
      } catch {
        // try once more
      }
    }
    return {
      saved: 'Your choice is saved. Pull down on the wallet to refresh it.',
    };
  } catch (error) {
    await refetchWallet().catch(() => undefined);
    return error instanceof Error && error.message
      ? error.message
      : 'This savings goal changed. Pull to refresh to see where it stands.';
  }
}
