import * as Crypto from 'expo-crypto';
import type { Dispatch, SetStateAction } from 'react';
import { showAppAlert } from '@/components/ui/show-app-alert';
import { createSavingsGoal } from '@/lib/customer-savings';
import {
  cancelSavingsReminderNotification,
  scheduleSavingsReminderNotification,
} from '@/services/savings-reminder-notifications';
import { handOffToWallet } from './hand-off-to-wallet';
import { rememberPlanInterestAnswer } from './plan-interest-answers';
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

export { PLAN_CREATED_HEAD_START_PENDING } from './hand-off-to-wallet';

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
  /**
   * PiggyVest plans: starts the plan's savings wallet setup right after the
   * plan is created, with the interest answer from the form. Best effort and
   * time-boxed: the wallet keeps checking and retrying afterwards.
   */
  startGoalWalletSetup?: (goalId: string) => Promise<unknown>;
  /** Re-checked at submit so no caller can skip the form's gates. */
  acceptsNonWithdrawableTerms?: boolean;
  /** PiggyVest only: the interest answer; null until chosen. */
  interestChoice?: boolean | null;
  /** The customer's own PiggyVest verdict: picks a new payment's rail. */
  primaryRail?: boolean;
  /** The plan exists but its hand-off could not finish (wallet not loaded). */
  onHandOffPending?: (goalId: string) => void;
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
  /** The account that submitted; goal creation is refused for any other. */
  submittingUserId?: string;
};

type ValidatedSavingsInput = {
  formattedStartDate: string;
  selectedProduct: SavingsProductChoice;
};

/** How long plan creation waits for setup before moving on. */
export const GOAL_WALLET_SETUP_WAIT_MS = 8000;

/**
 * Kicks off the savings wallet setup and waits a short while for it, so a
 * quick provider answer lands before the customer sees the plan. A slow or
 * failed start never blocks the plan: the wallet keeps checking afterwards.
 * A start still running after the wait is left to finish, never cancelled:
 * the server holds one setup per goal under a claim, and the automatic retry
 * only runs once that claim has expired (setup_retryable), so the two never
 * overlap.
 */
async function startSetupBriefly(
  start: (goalId: string) => Promise<unknown>,
  goalId: string
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve()
        .then(() => start(goalId))
        .catch(() => undefined),
      new Promise((resolve) => {
        timer = setTimeout(resolve, GOAL_WALLET_SETUP_WAIT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
      expectedUserId: input.submittingUserId,
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
    // The plan exists now: record it before anything can cut this short (a
    // form edit or reload in flight), so a later submit never creates another.
    if (input.deferInitialContribution && input.onContinueInWallet) {
      input.onHandOffPending?.(result.goalId);
    }
    // Kept (also on the device) so the sheet can finish setup if this start
    // never lands, even after a restart.
    if (input.startGoalWalletSetup && typeof input.interestChoice === 'boolean')
      await rememberPlanInterestAnswer(result.goalId, input.interestChoice);
    // Started now but waited for only after the reminder is scheduled, so a
    // slow start can never leave a created plan without its reminder.
    const setupStart = input.startGoalWalletSetup
      ? startSetupBriefly(input.startGoalWalletSetup, result.goalId)
      : Promise.resolve();
    if (requestIdempotencyKey) {
      input.setInitialContributionIdempotencyKey((currentKey) =>
        currentKey === requestIdempotencyKey ? null : currentKey
      );
    }
    if (!isCurrent()) {
      await setupStart;
      return;
    }
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
    await setupStart;
    if (!isCurrent()) return;
    if (input.deferInitialContribution && input.onContinueInWallet) {
      input.setShowFundingModal(false);
      input.setShowPreviewModal(false);
      input.setFormError(null);
      // Load the new goal into the wallet data first: the wallet opens the
      // goal by id and falls back to an older active plan when it is not
      // there yet. Without the reload, never prefill a head start that could
      // land on the wrong plan.
      await handOffToWallet(input, result.goalId, isCurrent);
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
