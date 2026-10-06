import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { showAppAlert } from '@/components/ui/show-app-alert';
import { setClipboardString } from '@/lib/clipboard';
import { addSavingsContribution } from '@/lib/customer-savings';
import { WALLET_TOP_UP_MIN_AMOUNT } from '@/lib/wallet-top-up-constants';
import { cancelSavingsReminderNotification } from '@/services/savings-reminder-notifications';
import { runSavingsCardAuthorization } from './run-savings-card-authorization';
import {
  runSavingsGoalSubmission,
  type UseStartSavingsSubmitInput,
} from './run-savings-goal-submission';
import { formatDateInput } from './start-savings.helpers';
import type { SavingsProductChoice } from './start-savings.types';

type SavingsInputValidation =
  | {
      formattedStartDate: string;
      ok: true;
      selectedProduct: SavingsProductChoice;
    }
  | { error: string; ok: false };

function validateSavingsInput(
  input: UseStartSavingsSubmitInput
): SavingsInputValidation {
  if (!input.selectedProduct) {
    return { error: 'Select a product to save for.', ok: false };
  }

  if (
    input.selectedProduct.requiresVariantSelection !== false ||
    (input.selectedProduct.variantId !== null &&
      (typeof input.selectedProduct.variantId !== 'string' ||
        !input.selectedProduct.variantId.trim()))
  ) {
    return {
      error: 'Select the exact device variant you want to save for.',
      ok: false,
    };
  }

  if (input.sourceMode === 'auto_debit' && !input.selectedPaymentMethodId) {
    return { error: 'Select a saved card for auto debit.', ok: false };
  }

  const formattedStartDate = formatDateInput(input.startDate);
  if (!formattedStartDate) {
    return { error: 'Select a valid start date.', ok: false };
  }

  return {
    formattedStartDate,
    ok: true,
    selectedProduct: input.selectedProduct,
  };
}

export function useStartSavingsSubmit(input: UseStartSavingsSubmitInput) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAuthorizingCard, setIsAuthorizingCard] = useState(false);
  const authorizationInFlightRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const contextRef = useRef({ active: true, key: '' });
  const mountedRef = useRef(true);
  const contextKey = JSON.stringify([
    input.activeMerchantId,
    input.activeMerchantSlug,
    input.selectedProduct,
    input.sourceMode,
    input.selectedPaymentMethodId,
    input.targetValue,
    input.contributionValue,
    input.effectiveInitialContribution,
    input.frequency,
    input.startDate,
    input.maturityDate,
    input.preferredDebitTime,
  ]);
  useEffect(() => {
    const context = { active: true, key: contextKey };
    contextRef.current = context;
    return () => {
      context.active = false;
    };
  }, [contextKey]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const submitSavingsGoal = async (options?: {
    deferInitialContribution?: boolean;
  }) => {
    if (submitInFlightRef.current) {
      return;
    }

    const validation = validateSavingsInput(input);
    if (!validation.ok) {
      input.setFormError(validation.error);
      return;
    }

    submitInFlightRef.current = true;
    setIsSubmitting(true);
    const context = contextRef.current;
    await runSavingsGoalSubmission(
      {
        ...input,
        deferInitialContribution:
          options?.deferInitialContribution ?? input.deferInitialContribution,
      },
      validation,
      () => context.active
    ).finally(() => {
      submitInFlightRef.current = false;
      if (mountedRef.current) setIsSubmitting(false);
    });
  };

  const submitBankTransferContribution = async () => {
    const goalId = input.createdGoalId;
    if (!goalId || submitInFlightRef.current) {
      return;
    }
    const amount = input.effectiveInitialContribution;
    if (amount <= 0) {
      input.setShowTransferModal(false);
      input.setFormError(null);
      input.setCreatedGoalId?.(null);
      input.setShowSuccessModal(true);
      return;
    }
    submitInFlightRef.current = true;
    setIsSubmitting(true);
    try {
      const idempotencyKey =
        input.initialContributionIdempotencyKey ?? Crypto.randomUUID();
      if (!input.initialContributionIdempotencyKey) {
        input.setInitialContributionIdempotencyKey(idempotencyKey);
      }
      const contributionResult = await addSavingsContribution({
        amount,
        goalId,
        idempotencyKey,
        merchantId: input.activeMerchantId,
        merchantSlug: input.activeMerchantSlug,
      });
      if (!mountedRef.current) return;
      // Completion reconciliation for the deferred path: the reminder was
      // retained at creation because the transfer was unconfirmed — now that
      // a confirmed contribution completes the goal, cancel it.
      if (contributionResult.goalStatus === 'completed') {
        try {
          await cancelSavingsReminderNotification(goalId);
        } catch {
          // Reminder cleanup is best effort after a confirmed contribution.
        }
      }
      input.setInitialContributionIdempotencyKey(null);
      input.setCreatedGoalId?.(null);
      input.setShowTransferModal(false);
      input.setFormError(null);
      input.setShowSuccessModal(true);
      try {
        await input.refetch();
      } catch {
        input.setFormError('Plan funded but unable to refresh wallet data.');
      }
    } catch (error) {
      if (!mountedRef.current) return;
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Unable to record the contribution.';
      input.setFormError(message);
      showAppAlert({
        title: 'Contribution not recorded',
        message,
        variant: 'error',
      });
    } finally {
      submitInFlightRef.current = false;
      if (mountedRef.current) setIsSubmitting(false);
    }
  };

  const handleAuthorizeSavingsCard = async () => {
    if (authorizationInFlightRef.current) {
      return;
    }

    authorizationInFlightRef.current = true;
    setIsAuthorizingCard(true);
    const context = contextRef.current;
    await runSavingsCardAuthorization(input, () => context.active).finally(
      () => {
        authorizationInFlightRef.current = false;
        if (mountedRef.current) setIsAuthorizingCard(false);
      }
    );
  };

  const handleCopyFundingAccount = async () => {
    if (!input.fundingAccount) {
      return;
    }
    const copied = await setClipboardString(
      input.fundingAccount.account_number
    );
    showAppAlert({
      title: copied ? 'Copied' : 'Unable to copy',
      message: copied
        ? 'Account number copied to clipboard.'
        : 'Unable to copy account number.',
      variant: copied ? 'success' : 'error',
    });
  };

  return {
    goToWallet: () =>
      router.replace({
        pathname: '/wallet',
        params: { action: 'savings' },
      }),
    handleAuthorizeSavingsCard,
    handleCopyFundingAccount,
    isAuthorizingCard,
    isSubmitting,
    submitBankTransferContribution,
    openWalletFundingScreen: () => {
      // Fund enough for the first contribution, but never send Paystack below the provider minimum.
      const maxNeeded = Math.max(
        input.requiredTopUpAmount,
        input.contributionValue
      );
      const requiredAmount = Math.max(
        WALLET_TOP_UP_MIN_AMOUNT,
        Math.ceil(maxNeeded)
      );

      return router.push({
        pathname: '/wallet',
        params: {
          action: 'fund',
          requiredAmount: String(requiredAmount),
          returnTo: '/wallet/savings/start',
        },
      });
    },
    submitSavingsGoal,
  };
}
