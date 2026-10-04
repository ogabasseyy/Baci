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
export type FundingAccount = {
  account_number: string;
} | null;

export type UseStartSavingsSubmitInput = {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  contributionValue: number;
  createdGoalId?: string | null;
  deferInitialContribution?: boolean;
  effectiveInitialContribution: number;
  frequency: SavingsFrequency;
  fundingAccount: FundingAccount;
  goalIdempotencyKey: string | null;
  setGoalIdempotencyKey: (value: string | null) => void;
  setCreatedGoalId?: (goalId: string | null) => void;
  initialContributionIdempotencyKey: string | null;
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
        if (input.targetValue > requestInitialContribution) {
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
