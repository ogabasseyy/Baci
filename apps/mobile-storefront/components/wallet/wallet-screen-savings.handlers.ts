import { Alert } from 'react-native';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import {
  resolveSavingsGoalVariant,
  swapSavingsGoalDevice,
} from '@/lib/customer-savings';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import type { Product } from '@/types/product';
import { toSelectedProductChoice } from './savings/start-savings-controller.utils';

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

function isCompletedSavingsContributionResult(result: unknown) {
  return (
    typeof result === 'object' &&
    result !== null &&
    'goalStatus' in result &&
    result.goalStatus === 'completed'
  );
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
      'Fund wallet first',
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
      amount >= remainingAmount ||
      isCompletedSavingsContributionResult(contributionResult)
    ) {
      try {
        await cancelSavingsReminder?.(goal.id);
      } catch {
        // Reminder cleanup is best effort after a confirmed contribution.
      }
    }
    clearSavingsContributionAmount();
    clearIdempotencyKey?.();
    try {
      await refetchWallet();
    } catch {
      Alert.alert(
        'Savings updated',
        `Added ${formatNgnCurrency(amount)} to your savings goal, but wallet refresh failed. Pull to refresh your latest balance.`
      );
      return;
    }
    Alert.alert(
      'Savings updated',
      `Added ${formatNgnCurrency(amount)} to your savings goal.`
    );
  } catch (error) {
    Alert.alert(
      'Unable to add savings',
      error instanceof Error ? error.message : 'Please try again in a moment.'
    );
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
    Alert.alert(
      'Device updated',
      `Your savings goal is now for ${choice.name}.`
    );
    return true;
  } catch (error) {
    Alert.alert(
      'Unable to change device',
      error instanceof Error ? error.message : 'Please try again in a moment.'
    );
    return false;
  }
}

export async function resolveCompletedSavingsGoalVariant({
  activeMerchantId,
  activeMerchantSlug,
  goal,
  refetchWallet,
  variantId,
}: ResolveSavingsGoalVariantParams): Promise<boolean> {
  const eligibleVariant = goal?.variant_resolution_options?.find(
    (option) => option.id === variantId
  );
  if (
    goal?.status !== 'completed' ||
    !goal.selection_unresolved ||
    !eligibleVariant
  ) {
    Alert.alert(
      'Variant unavailable',
      'Refresh your savings goal and try again.'
    );
    return false;
  }

  try {
    await resolveSavingsGoalVariant({
      goalId: goal.id,
      merchantId: activeMerchantId,
      merchantSlug: activeMerchantSlug,
      variantId,
    });
    try {
      await refetchWallet();
    } catch {
      Alert.alert(
        'Variant resolved',
        'Your device variant was saved, but the wallet could not refresh. Pull to refresh before buying.'
      );
      return true;
    }
    Alert.alert(
      'Variant resolved',
      `Your savings goal is now linked to ${eligibleVariant.label}.`
    );
    return true;
  } catch (error) {
    await refetchWallet().catch(() => undefined);
    Alert.alert(
      'Review savings goal',
      error instanceof Error
        ? error.message
        : 'This savings goal changed. Refresh to review its current status.'
    );
    return false;
  }
}
