import * as Crypto from 'expo-crypto';
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
  isInsufficientWalletError,
} from './start-savings-controller.utils';
export type FundingAccount = {
  account_number: string;
} | null;

export type UseStartSavingsSubmitInput = {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  contributionValue: number;
  effectiveInitialContribution: number;
  frequency: SavingsFrequency;
  fundingAccount: FundingAccount;
  initialContributionIdempotencyKey: string | null;
  maturityDate: string;
  normalizedVariantId?: string;
  preferredDebitTime: string;
  refetch: () => Promise<unknown>;
  requiredTopUpAmount: number;
  selectedPaymentMethodId: string | null;
  selectedProduct: SavingsProductChoice | null;
  setFormError: (value: string | null) => void;
  setInitialContributionIdempotencyKey: (value: string | null) => void;
  setShowFundingModal: (value: boolean) => void;
  setShowPreviewModal: (value: boolean) => void;
  setShowSuccessModal: (value: boolean) => void;
  setShowTransferModal: (value: boolean) => void;
  sourceMode: SavingsSourceMode;
  startDate: string;
  targetValue: number;
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
  validation: ValidatedSavingsInput
): Promise<void> {
  try {
    const requestInitialContribution =
      input.sourceMode === 'auto_debit'
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
    const result = await createSavingsGoal({
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
      variantId: input.normalizedVariantId ?? null,
    });
    if (!result.success) {
      throw new Error('Unable to create savings plan.');
    }
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
    input.setShowFundingModal(false);
    input.setShowPreviewModal(false);
    input.setShowTransferModal(false);
    input.setFormError(null);
    input.setInitialContributionIdempotencyKey(null);
    input.setShowSuccessModal(true);
    try {
      await input.refetch();
    } catch {
      input.setFormError('Plan created but unable to refresh wallet data.');
    }
  } catch (error) {
    if (isInsufficientWalletError(error) && input.fundingAccount) {
      input.setShowTransferModal(true);
      return;
    }
    const message = getErrorMessage(error, 'Unable to create savings plan.');
    input.setFormError(message);
    showAppAlert({
      title: 'Unable to create plan',
      message,
      variant: 'error',
    });
  }
}
