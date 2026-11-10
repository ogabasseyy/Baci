import * as Crypto from 'expo-crypto';
import type { Dispatch, SetStateAction } from 'react';
import { showAppAlert } from '@/components/ui/show-app-alert';
import { createSavingsGoal } from '@/lib/customer-savings';
import {
  cancelSavingsReminderNotification,
  scheduleSavingsReminderNotification,
} from '@/services/savings-reminder-notifications';
import {
  getSavingsReminderScheduledAt,
  type SavingsFrequency,
} from './start-savings.helpers';
import type {
  SavingsProductChoice,
  SavingsSourceMode,
} from './start-savings.types';
import {
  getErrorMessage,
  isGoalIdempotencyMismatchError,
  isInsufficientWalletError,
} from './start-savings-controller.utils';
import type { ContributionRail } from './stored-contribution-operation';
export const PLAN_CREATED_HEAD_START_PENDING =
  'Your plan was created, but we could not load it yet. Open your wallet to add the head start.';

/** The wallet refetch succeeded and its data includes the plan by id. */
function walletHasGoal(refetchResult: unknown, goalId: string): boolean {
  if (!refetchResult || typeof refetchResult !== 'object') return false;
  const { isError, data } = refetchResult as {
    isError?: boolean;
    data?: {
      wallet?: {
        active_savings_goal?: { id?: string } | null;
        savings_goals?: Array<{ id?: string }>;
      };
    };
  };
  if (isError) return false;
  const wallet = data?.wallet;
  return (
    wallet?.active_savings_goal?.id === goalId ||
    (wallet?.savings_goals ?? []).some((goal) => goal.id === goalId)
  );
}

export type FundingAccount = {
  account_number: string;
} | null;

export type UseStartSavingsSubmitInput = {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  contributionValue: number;
  createdGoalId?: string | null;
  deferInitialContribution?: boolean;
  /**
   * With a deferred first contribution: instead of the bank-transfer sheet,
   * hand the created goal and its head start to the wallet, which moves the
   * money through PiggyVest.
   */
  onContinueInWallet?: (goalId: string, amount: number) => void;
  effectiveInitialContribution: number;
  frequency: SavingsFrequency;
  fundingAccount: FundingAccount;
  goalIdempotencyKey: string | null;
  setGoalIdempotencyKey: (value: string | null) => void;
  setCreatedGoalId?: (goalId: string | null) => void;
  initialContributionIdempotencyKey: string | null;
  /** Rail recorded with the stored id; null when none was recorded. */
  initialContributionRail?: ContributionRail | null;
  setInitialContributionRail?: (
    operationId: string,
    rail: ContributionRail
  ) => void;
  maturityDate: string;
  preferredDebitTime: string;
  refetch: () => Promise<unknown>;
  requiredTopUpAmount: number;
  selectedPaymentMethodId: string | null;
  selectedProduct: SavingsProductChoice | null;
  setFormError: (value: string | null) => void;
  setInitialContributionIdempotencyKey: Dispatch<SetStateAction<string | null>>;
  setShowFundingModal: (value: boolean) => void;
  setShowPreviewModal: (value: boolean) => void;
  setShowSuccessModal: (value: boolean) => void;
  setShowTransferModal: (value: boolean) => void;
  sourceMode: SavingsSourceMode;
  startDate: string;
  targetValue: number;
  variantId?: string | null;
};

type ValidatedSavingsInput = {
  formattedStartDate: string;
  selectedProduct: SavingsProductChoice;
};

/**
 * Runs the savings goal creation flow for `useStartSavingsSubmit`. Lives at
 * module scope (outside the hook render) so its try/throw control flow does
 * not block React Compiler memoization of the hook.
 */
export async function runSavingsGoalSubmission(
  input: UseStartSavingsSubmitInput,
  validation: ValidatedSavingsInput,
  isCurrent: () => boolean = () => true
): Promise<void> {
  try {
    const requestInitialContribution =
      input.sourceMode === 'auto_debit' || input.deferInitialContribution
        ? 0
        : input.effectiveInitialContribution;
    // Auto-debit savings starts with requestInitialContribution = 0, so no
    // requestIdempotencyKey is needed. Manual contributions reuse
    // input.initialContributionIdempotencyKey; only a missing key is created
    // with Crypto.randomUUID and persisted through input.setInitialContributionIdempotencyKey.
    const requestIdempotencyKey =
      requestInitialContribution > 0
        ? (input.initialContributionIdempotencyKey ?? Crypto.randomUUID())
        : undefined;
    if (requestIdempotencyKey && !input.initialContributionIdempotencyKey) {
      input.setInitialContributionIdempotencyKey(requestIdempotencyKey);
    }
    const requestGoalKey = input.goalIdempotencyKey ?? Crypto.randomUUID();
    if (!input.goalIdempotencyKey) input.setGoalIdempotencyKey(requestGoalKey);
    const result = await createSavingsGoal({
      goalIdempotencyKey: requestGoalKey,
      autoDebitAuthorized: input.sourceMode === 'auto_debit' ? true : undefined,
      contributionAmount: input.contributionValue,
      contributionFrequency: input.frequency,
      initialContributionAmount: requestInitialContribution,
      initialContributionIdempotencyKey: requestIdempotencyKey,
      maturityDate: input.maturityDate,
      merchantId: input.activeMerchantId,
      merchantSlug: input.activeMerchantSlug,
      nonWithdrawableAccepted: true,
      productId: validation.selectedProduct.id,
      savedPaymentMethodId:
        input.sourceMode === 'auto_debit'
          ? input.selectedPaymentMethodId
          : null,
      sourceMode: input.sourceMode,
      startDate: validation.formattedStartDate,
      targetAmount: input.targetValue,
      termsAccepted: true,
      title: validation.selectedProduct.name,
      variantId: validation.selectedProduct.variantId,
    });
    if (result.success !== true) {
      throw new Error('Unable to create savings plan.');
    }
    if (requestIdempotencyKey) {
      input.setInitialContributionIdempotencyKey((currentKey) =>
        currentKey === requestIdempotencyKey ? null : currentKey
      );
    }
    if (!isCurrent()) return;
    if (input.sourceMode === 'manual') {
      try {
        // A deferred transfer is unconfirmed: the goal is created with an
        // initial contribution of 0, and the customer may leave the funding
        // screen without sending anything. Always schedule the reminder for
        // deferred plans — completion reconciliation cancels it once a
        // confirmed contribution completes the goal. Only an immediate
        // (requested-now) contribution that fully funds the goal at creation
        // may cancel instead of scheduling.
        if (
          input.deferInitialContribution ||
          input.targetValue > requestInitialContribution
        ) {
          await scheduleSavingsReminderNotification({
            contributionAmount: input.contributionValue,
            frequency: input.frequency,
            goalId: result.goalId,
            goalTitle: validation.selectedProduct.name,
            scheduledAt: getSavingsReminderScheduledAt({
              preferredDebitTime: input.preferredDebitTime,
              startDate: validation.formattedStartDate,
            }),
          });
        } else {
          await cancelSavingsReminderNotification(result.goalId);
        }
      } catch {
        // Reminder scheduling is best effort and must not block goal creation.
      }
    }
    if (!isCurrent()) return;
    if (input.deferInitialContribution && input.onContinueInWallet) {
      input.setShowFundingModal(false);
      input.setShowPreviewModal(false);
      input.setFormError(null);
      // Load the new goal into the wallet data first: the wallet opens the
      // goal by id and falls back to an older active plan when it is not
      // there yet. Without the reload, never prefill a head start that could
      // land on the wrong plan.
      // A failed refetch resolves with an error result rather than throwing,
      // so the reloaded data itself must contain the new plan.
      let loaded = false;
      try {
        loaded = walletHasGoal(await input.refetch(), result.goalId);
      } catch {
        loaded = false;
      }
      if (!isCurrent()) return;
      if (!loaded) {
        input.setFormError(PLAN_CREATED_HEAD_START_PENDING);
        return;
      }
      input.onContinueInWallet(
        result.goalId,
        input.effectiveInitialContribution
      );
      return;
    }
    if (input.deferInitialContribution) {
      input.setCreatedGoalId?.(result.goalId);
      input.setShowFundingModal(false);
      input.setShowPreviewModal(false);
      input.setFormError(null);
      input.setShowTransferModal(true);
      try {
        await input.refetch();
      } catch {
        if (isCurrent())
          input.setFormError('Plan created but unable to refresh wallet data.');
      }
      return;
    }
    input.setShowFundingModal(false);
    input.setShowPreviewModal(false);
    input.setShowTransferModal(false);
    input.setFormError(null);
    input.setShowSuccessModal(true);
    try {
      await input.refetch();
    } catch {
      if (isCurrent())
        input.setFormError('Plan created but unable to refresh wallet data.');
    }
  } catch (error) {
    if (!isCurrent()) return;
    if (isInsufficientWalletError(error) && input.fundingAccount) {
      input.setShowTransferModal(true);
      return;
    }
    const mismatch = isGoalIdempotencyMismatchError(error);
    if (mismatch) input.setGoalIdempotencyKey(null);
    const message = mismatch
      ? 'Your plan details changed. Please submit again to create your plan.'
      : getErrorMessage(error, 'Unable to create savings plan.');
    input.setFormError(message);
    showAppAlert({
      title: 'Unable to create plan',
      message,
      variant: 'error',
    });
  }
}
