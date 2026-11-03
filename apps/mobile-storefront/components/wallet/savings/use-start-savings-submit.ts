import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { showAppAlert } from '@/components/ui/show-app-alert';
import { setClipboardString } from '@/lib/clipboard';
import { addSavingsContribution } from '@/lib/customer-savings';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { addPiggyvestPrimarySavingsContribution } from '@/lib/piggyvest-primary-savings';
import { WALLET_TOP_UP_MIN_AMOUNT } from '@/lib/wallet-top-up-constants';
import { cancelSavingsReminderNotification } from '@/services/savings-reminder-notifications';
import { runSavingsCardAuthorization } from './run-savings-card-authorization';
import {
  runSavingsGoalSubmission,
  type UseStartSavingsSubmitInput,
} from './run-savings-goal-submission';
import {
  getErrorCode,
  reusableStoredOperationId,
} from './stored-contribution-operation';
import { validateSavingsInput } from './validate-savings-input';

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
      const isPrimary = isPiggyvestPrimaryMerchant(input.activeMerchantId);
      const storedKey = await reusableStoredOperationId({
        merchantId: input.activeMerchantId,
        operationId: input.initialContributionIdempotencyKey,
        isPrimary,
      });
      if (!mountedRef.current) return;
      const idempotencyKey = storedKey ?? Crypto.randomUUID();
      if (!storedKey) {
        input.setInitialContributionIdempotencyKey(idempotencyKey);
      }
      // Primary customers move money main wallet -> goal through PiggyVest
      // (stable operation id); the helper itself falls back to the legacy
      // rail on SAVINGS_NOT_READY. Legacy customers keep the legacy call.
      const contribute = isPrimary
        ? addPiggyvestPrimarySavingsContribution
        : addSavingsContribution;
      const contributionResult = await contribute({
        amount,
        goalId,
        idempotencyKey,
        merchantId: input.activeMerchantId,
        merchantSlug: input.activeMerchantSlug,
      });
      if (!mountedRef.current) return;
      const outcome = (contributionResult as { status?: unknown }).status;
      if (outcome === 'pending' || outcome === 'cancelled') {
        // Never "funded" until PiggyVest confirms. Pending keeps the stored
        // operation id so a retry cannot double-spend; cancelled releases it.
        if (outcome === 'cancelled') {
          input.setInitialContributionIdempotencyKey(null);
        }
        input.setFormError(null);
        showAppAlert({
          title:
            outcome === 'pending' ? 'Transfer pending' : 'Transfer cancelled',
          message:
            outcome === 'pending'
              ? 'Your plan will update after PiggyVest confirms the transfer. No new payment has been started.'
              : 'The transfer was cancelled and your reserved wallet funds were released. You can try again.',
          variant: outcome === 'pending' ? 'info' : 'error',
        });
        try {
          await input.refetch();
        } catch {
          // Refresh is best effort; the pending state is already shown.
        }
        return;
      }
      // Completion reconciliation for the deferred path: the reminder was
      // retained at creation because the transfer was unconfirmed — now that
      // a confirmed contribution completes the goal, cancel it.
      if (
        'goalStatus' in contributionResult &&
        contributionResult.goalStatus === 'completed'
      ) {
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
      if (getErrorCode(error) === 'WALLET_UNAVAILABLE') {
        // The server cancelled the reservation; the id can never be reused.
        input.setInitialContributionIdempotencyKey(null);
      }
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
