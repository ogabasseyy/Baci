import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { showAppAlert } from '@/components/ui/show-app-alert';
import { setClipboardString } from '@/lib/clipboard';
import { WALLET_TOP_UP_MIN_AMOUNT } from '@/lib/wallet-top-up-constants';
import { runBankTransferContribution } from './run-bank-transfer-contribution';
import { runSavingsCardAuthorization } from './run-savings-card-authorization';
import {
  runSavingsGoalSubmission,
  type UseStartSavingsSubmitInput,
} from './run-savings-goal-submission';
import { useWalletPinPrompt } from './use-wallet-pin-prompt';
import { validateSavingsInput } from './validate-savings-input';

export function useStartSavingsSubmit(input: UseStartSavingsSubmitInput) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAuthorizingCard, setIsAuthorizingCard] = useState(false);
  const authorizationInFlightRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const contextRef = useRef({ active: true, key: '' });
  const mountedRef = useRef(true);
  const { requestProof, sheetProps: pinSheetProps } = useWalletPinPrompt();
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
      await runBankTransferContribution(input, goalId, amount, {
        isMounted: () => mountedRef.current,
        requestPinProof: requestProof,
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
    pinSheetProps,
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
