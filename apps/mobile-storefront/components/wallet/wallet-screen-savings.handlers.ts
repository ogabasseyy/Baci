import { triggerHaptic } from '@/hooks/use-haptics';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { swapSavingsGoalDevice } from '@/lib/customer-savings';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import type { Product } from '@/types/product';
import { readConfirmedContribution } from './read-confirmed-contribution';
import { clearSavingsNotice, savingsNotifier } from './savings/savings-notice';
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
  // Captured before any await: a result never reaches another account.
  const notify = savingsNotifier();
  if (!goal) {
    notify('No active savings goal', 'Start a savings goal first.', 'warning');
    return;
  }

  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    notify('Invalid amount', 'Enter the amount you want to save.', 'warning');
    return;
  }

  const remainingAmount = Math.max(0, goal.target_amount - goal.current_amount);
  if (amount > remainingAmount) {
    notify(
      'Amount too high',
      `You only have ${formatNgnCurrency(remainingAmount)} left on this goal.`,
      'warning'
    );
    return;
  }

  if (amount > walletBalance) {
    notify(
      'Add money first',
      `Your wallet has ${formatNgnCurrency(walletBalance)} available. Fund it before adding ${formatNgnCurrency(amount)} to savings.`,
      'warning'
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
      notify(
        'Contribution pending',
        'Your savings will update once PiggyVest confirms the transfer.',
        'info'
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
      notify(
        'Contribution cancelled',
        'The transfer was cancelled before submission and your reserved wallet funds were released.',
        'info'
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
    notify(success.title, success.message, 'success');
  } catch (error) {
    reportContributionError(error, clearIdempotencyKey, notify);
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
  // Captured before any await: a result never reaches another account.
  const notify = savingsNotifier();
  if (!goal) {
    notify('No active savings goal', 'Start a savings goal first.', 'warning');
    return false;
  }

  const choice = toSelectedProductChoice({ product, variantId });
  if (choice.price < goal.current_amount) {
    notify(
      'Device price too low',
      `You have already saved ${formatNgnCurrency(goal.current_amount)}. Choose a device priced at or above this amount.`,
      'warning'
    );
    return false;
  }

  // A retry must not leave the previous failure on screen after it works.
  clearSavingsNotice();
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
      notify(
        'Device updated',
        'Your savings device was updated, but wallet refresh failed. Pull to refresh your latest goal.',
        'success'
      );
      return true;
    }
    // A calm inline confirmation; a failed refresh keeps its own notice above.
    notify(
      'Phone changed',
      `Your savings now go towards ${product.name}.`,
      'success'
    );
    return true;
  } catch (error) {
    notify(
      'Unable to change device',
      error instanceof Error ? error.message : 'Please try again in a moment.',
      'warning'
    );
    return false;
  }
}

export { resolveCompletedSavingsGoalVariant } from './resolve-completed-savings-goal-variant';
export { createSavingsVariantResolutionHandler } from './savings-variant-resolution.handlers';
