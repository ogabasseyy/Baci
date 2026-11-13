import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { showAppAlert } from '@/components/ui/show-app-alert';
import { setClipboardString } from '@/lib/clipboard';
import { WALLET_TOP_UP_MIN_AMOUNT } from '@/lib/wallet-top-up-constants';
import { useAuthStore } from '@/stores/auth-store';
import { confirmPrimaryHeadStartBalance } from './confirm-primary-head-start-balance';
import {
  handOffToWallet,
  PLAN_ALREADY_CREATED_MESSAGE,
  SIGN_IN_TO_START_SAVINGS_MESSAGE,
} from './hand-off-to-wallet';
import { runBankTransferContribution } from './run-bank-transfer-contribution';
import { runSavingsCardAuthorization } from './run-savings-card-authorization';
import {
  runSavingsGoalSubmission,
  type UseStartSavingsSubmitInput,
} from './run-savings-goal-submission';
import { wholeNairaHeadStart } from './start-savings-wallet-balance';
import { useWalletPinPrompt } from './use-wallet-pin-prompt';
import { validateSavingsInput } from './validate-savings-input';

export function useStartSavingsSubmit(input: UseStartSavingsSubmitInput) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAuthorizingCard, setIsAuthorizingCard] = useState(false);
  const authorizationInFlightRef = useRef(false);
  const submitInFlightRef = useRef(false);
  // The signed-in account: none blocks a submit, a mid-submit switch cancels.
  const authUserId = useAuthStore((state) => state.user?.id);
  const authUserIdRef = useRef(authUserId);
  // Bumped on every account change, so switching away and back mid-submit
  // still cancels that submit.
  const accountGenerationRef = useRef(0);
  useEffect(() => {
    authUserIdRef.current = authUserId;
    accountGenerationRef.current += 1;
  }, [authUserId]);
  // A created plan, for its account: one whose wallet hand-off could not
  // finish (handOff), or one whose submit was cut short by an account switch
  // before it finished, so the unchanged draft never creates it twice.
  // Kept per account, so another account's plan never replaces or clears it.
  const pendingPlansRef = useRef(
    new Map<string, { goalId: string; contextKey: string; handOff: boolean }>()
  );
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
    input.interestChoice ?? null, // fixed once the plan exists
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
    continueInWallet?: boolean;
    /** Confirm a fresh PiggyVest balance covers the head start first. */
    confirmPrimaryBalance?: boolean;
  }) => {
    if (submitInFlightRef.current) {
      return;
    }

    const validation = validateSavingsInput(input);
    if (!validation.ok) {
      input.setFormError(validation.error);
      return;
    }
    if (!authUserIdRef.current) {
      input.setFormError(SIGN_IN_TO_START_SAVINGS_MESSAGE);
      return;
    }
    submitInFlightRef.current = true;
    setIsSubmitting(true);
    const release = () => {
      submitInFlightRef.current = false;
      if (mountedRef.current) setIsSubmitting(false);
    };
    const context = contextRef.current;
    const submittingUserId = authUserIdRef.current;
    const generation = accountGenerationRef.current;
    const stillCurrent = () =>
      context.active && accountGenerationRef.current === generation;
    // A plan already exists for this account but its head start never moved:
    // only the unchanged wallet hand-off may continue it. Any edit, a dropped
    // head start or another funding choice must not create a second plan or
    // fund that plan with different details.
    const accountKey = submittingUserId ?? '';
    const pending = pendingPlansRef.current.get(accountKey) ?? null;
    const sameDraft = pending?.contextKey === context.key;
    if (
      pending &&
      (pending.handOff ? !(options?.continueInWallet && sameDraft) : sameDraft)
    ) {
      input.setFormError(PLAN_ALREADY_CREATED_MESSAGE);
      release();
      return;
    }
    if (options?.confirmPrimaryBalance) {
      // Inside the guarded lifecycle: no second submit can start, and an
      // edit to the plan or another account during the read drops this one.
      const refusal = await confirmPrimaryHeadStartBalance(input);
      const current = stillCurrent();
      if (refusal || !current) {
        if (refusal && current) input.setFormError(refusal);
        release();
        return;
      }
    }
    // The head start moves through PiggyVest from the wallet's Add to
    // savings sheet, prefilled with the amount the customer chose.
    const continueInWallet = (goalId: string, amount: number) => {
      pendingPlansRef.current.delete(accountKey);
      router.replace({
        pathname: '/wallet',
        params: {
          action: 'savings',
          savingsGoalId: goalId,
          savingsAmount: String(wholeNairaHeadStart(amount)),
        },
      });
    };
    const record = (goalId: string, handOff: boolean) => {
      pendingPlansRef.current.set(accountKey, {
        goalId,
        contextKey: context.key,
        handOff,
      });
    };
    const onHandOffPending = (goalId: string) => record(goalId, true);
    const onPlanCreated = (goalId: string) => record(goalId, false);
    if (pending?.handOff) {
      // The plan already exists: retry its hand-off, never create another.
      await handOffToWallet(
        {
          ...input,
          onContinueInWallet: continueInWallet,
          onHandOffPending,
        },
        pending.goalId,
        stillCurrent
      ).finally(release);
      return;
    }
    await runSavingsGoalSubmission(
      {
        ...input,
        deferInitialContribution:
          options?.deferInitialContribution ?? input.deferInitialContribution,
        onContinueInWallet: options?.continueInWallet
          ? continueInWallet
          : undefined,
        onHandOffPending,
        onPlanCreated,
        submittingUserId,
      },
      validation,
      stillCurrent
    ).finally(() => {
      // Finished on screen: the plan is shown, so its record is done with.
      if (
        stillCurrent() &&
        pendingPlansRef.current.get(accountKey)?.handOff === false
      )
        pendingPlansRef.current.delete(accountKey);
      release();
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
