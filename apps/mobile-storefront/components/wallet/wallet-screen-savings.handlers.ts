import { Alert } from 'react-native';
import { triggerHaptic } from '@/hooks/use-haptics';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import {
  resolveSavingsGoalVariant,
  swapSavingsGoalDevice,
} from '@/lib/customer-savings';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import type { Product } from '@/types/product';
import { readConfirmedContribution } from './read-confirmed-contribution';
import { toSelectedProductChoice } from './savings/start-savings-controller.utils';
import { buildSavingsSuccessMessage } from './savings-contribution-success';
import { reportContributionError } from './wallet-contribution-error';

interface AddSavingsContributionParams {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  addSavingsContribution: (input: {
    amount: number;
    goalId: string;
    idempotencyKey: string;
    merchantId?: string;
    merchantSlug?: string;
  }) => Promise<unknown>;
  clearSavingsContributionAmount: () => void;
  clearIdempotencyKey?: () => void;
  createIdempotencyKey: () => string;
  cancelSavingsReminder?: (goalId: string) => Promise<unknown>;
  goal: WalletActiveSavingsGoal | null;
  rawAmount: string;
  refetchWallet: () => Promise<unknown>;
  setIsAddingSavingsContribution: (isPending: boolean) => void;
  walletBalance: number;
}

interface ChangeSavingsGoalDeviceParams {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  goal: WalletActiveSavingsGoal | null;
  product: Product;
  refetchWallet: () => Promise<unknown>;
  variantId?: string | null;
}

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

export async function addSavingsContributionToGoal({
  activeMerchantId,
  activeMerchantSlug,
  addSavingsContribution,
  clearSavingsContributionAmount,
  clearIdempotencyKey,
  createIdempotencyKey,
  cancelSavingsReminder,
  goal,
  rawAmount,
  refetchWallet,
  setIsAddingSavingsContribution,
  walletBalance,
}: AddSavingsContributionParams): Promise<void> {
  if (!goal) {
    Alert.alert('No active savings goal', 'Start a savings goal first.');
    return;
  }

  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    Alert.alert('Invalid amount', 'Enter the amount you want to save.');
    return;
  }

  const remainingAmount = Math.max(0, goal.target_amount - goal.current_amount);
  if (amount > remainingAmount) {
    Alert.alert(
      'Amount too high',
      `You only have ${formatNgnCurrency(remainingAmount)} left on this goal.`
    );
    return;
  }

  if (amount > walletBalance) {
    Alert.alert(
      'Add money first',
      `Your wallet has ${formatNgnCurrency(walletBalance)} available. Fund it before adding ${formatNgnCurrency(amount)} to savings.`
    );
    return;
  }

  setIsAddingSavingsContribution(true);
  try {
    const contributionResult = await addSavingsContribution({
      amount,
      goalId: goal.id,
      idempotencyKey: createIdempotencyKey(),
      merchantId: activeMerchantId,
      merchantSlug: activeMerchantSlug,
    });
    if (
      typeof contributionResult === 'object' &&
      contributionResult !== null &&
      'status' in contributionResult &&
      contributionResult.status === 'pending'
    ) {
      await refetchWallet().catch(() => undefined);
      Alert.alert(
        'Contribution pending',
        'Your savings will update after PiggyVest confirms the transfer. Check its status before starting another contribution.'
      );
      return;
    }
    if (
      typeof contributionResult === 'object' &&
      contributionResult !== null &&
      'status' in contributionResult &&
      contributionResult.status === 'cancelled'
    ) {
      // Terminal provider rejection: the hold was released server-side,
      // so clear the operation for a safe retry without announcing
      // success or leaving the contribution looking pending. The
      // entered amount stays for the retry.
      clearIdempotencyKey?.();
      await refetchWallet().catch(() => undefined);
      Alert.alert(
        'Contribution cancelled',
        'The transfer was cancelled before submission and your reserved wallet funds were released.'
      );
      return;
    }
    // The server's verdict wins over the client guess, which a replayed
    // contribution with an already-refreshed goal would get wrong; the same
    // verdict drives both reminder cleanup and the celebration.
    const confirmed = readConfirmedContribution(contributionResult);
    const goalCompleted =
      confirmed.goalCompleted ??
      (confirmed.savedAfter === undefined
        ? amount >= remainingAmount
        : confirmed.savedAfter >= goal.target_amount);
    if (goalCompleted) {
      try {
        await cancelSavingsReminder?.(goal.id);
      } catch {
        // Reminder cleanup is best effort after a confirmed contribution.
      }
    }
    clearSavingsContributionAmount();
    clearIdempotencyKey?.();
    triggerHaptic('success');
    const refreshFailed = await refetchWallet().then(
      () => false,
      () => true
    );
    const success = buildSavingsSuccessMessage({
      amount,
      goal,
      // Celebrate completion only on the server's word; the client guess
      // above still drives best-effort reminder cleanup.
      goalCompleted:
        confirmed.goalCompleted ??
        (confirmed.savedAfter !== undefined &&
          confirmed.savedAfter >= goal.target_amount),
      refreshFailed,
      savedAfter: confirmed.savedAfter,
    });
    Alert.alert(success.title, success.message);
  } catch (error) {
    reportContributionError(error, clearIdempotencyKey);
  } finally {
    setIsAddingSavingsContribution(false);
  }
}

export async function changeSavingsGoalDevice({
  activeMerchantId,
  activeMerchantSlug,
  goal,
  product,
  refetchWallet,
  variantId,
}: ChangeSavingsGoalDeviceParams): Promise<boolean> {
  if (!goal) {
    Alert.alert('No active savings goal', 'Start a savings goal first.');
    return false;
  }

  const choice = toSelectedProductChoice({ product, variantId });
  if (choice.price < goal.current_amount) {
    Alert.alert(
      'Device price too low',
      `You have already saved ${formatNgnCurrency(goal.current_amount)}. Choose a device priced at or above this amount.`
    );
    return false;
  }

  try {
    await swapSavingsGoalDevice({
      goalId: goal.id,
      merchantId: activeMerchantId,
      merchantSlug: activeMerchantSlug,
      productId: product.id,
      variantId: variantId ?? null,
    });
    try {
      await refetchWallet();
    } catch {
      Alert.alert(
        'Device updated',
        'Your savings device was updated, but wallet refresh failed. Pull to refresh your latest goal.'
      );
      return true;
    }
    // The savings sheet shows the new phone; no alert on top of it.
    return true;
  } catch (error) {
    Alert.alert(
      'Unable to change device',
      error instanceof Error ? error.message : 'Please try again in a moment.'
    );
    return false;
  }
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
