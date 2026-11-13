import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { showAppAlert } from '@/components/ui/show-app-alert';
import { setClipboardString } from '@/lib/clipboard';
import { WALLET_TOP_UP_MIN_AMOUNT } from '@/lib/wallet-top-up-constants';
import { useAuthStore } from '@/stores/auth-store';
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
import {
  PRIMARY_BALANCE_CHECK_FAILED_MESSAGE,
  PRIMARY_HEAD_START_SHORT_MESSAGE,
  primaryHeadStartRefusal,
  readFreshPrimaryBalanceKobo,
  wholeNairaHeadStart,
} from './start-savings-wallet-balance';
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
  useEffect(() => {
    authUserIdRef.current = authUserId;
  }, [authUserId]);
  // A created plan whose wallet hand-off could not finish, for its account.
  const pendingHandOffRef = useRef<{
    goalId: string;
    userId?: string;
    contextKey: string;
  } | null>(null);
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
    const stillCurrent = () =>
      context.active && authUserIdRef.current === submittingUserId;
    // A plan already exists for this account but its head start never moved:
    // only the unchanged wallet hand-off may continue it. Any edit, a dropped
    // head start or another funding choice must not create a second plan or
    // fund that plan with different details.
    const pending =
      pendingHandOffRef.current?.userId === submittingUserId
        ? pendingHandOffRef.current
        : null;
    if (
      pending &&
      !(options?.continueInWallet && pending.contextKey === context.key)
    ) {
      input.setFormError(PLAN_ALREADY_CREATED_MESSAGE);
      release();
      return;
    }
    if (options?.confirmPrimaryBalance) {
      const headStartRefusal = primaryHeadStartRefusal(
        input.effectiveInitialContribution,
        input.targetValue
      );
      if (headStartRefusal) {
        input.setFormError(headStartRefusal);
        release();
        return;
      }
      // Inside the guarded lifecycle: no second submit can start, and an
      // edit to the plan while the balance is read cancels this one.
      // A thrown read counts as unconfirmed, so the lock is always released.
      let balanceKobo: number | null = null;
      try {
        balanceKobo = await readFreshPrimaryBalanceKobo(input.activeMerchantId);
      } catch {
        balanceKobo = null;
      }
      // The wallet's Add to savings sheet moves whole naira, rounding the
      // prefilled amount up: check the amount that will actually move.
      const headStartKobo =
        wholeNairaHeadStart(input.effectiveInitialContribution) * 100;
      const refusal =
        balanceKobo === null
          ? PRIMARY_BALANCE_CHECK_FAILED_MESSAGE
          : balanceKobo < headStartKobo
            ? PRIMARY_HEAD_START_SHORT_MESSAGE
            : null;
      // An edit or a different account during the read drops this one.
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
      pendingHandOffRef.current = null;
      router.replace({
        pathname: '/wallet',
        params: {
          action: 'savings',
          savingsGoalId: goalId,
          savingsAmount: String(wholeNairaHeadStart(amount)),
        },
      });
    };
    const onHandOffPending = (goalId: string) => {
      pendingHandOffRef.current = {
        goalId,
        userId: submittingUserId,
        contextKey: context.key,
      };
    };
    if (pending) {
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
        submittingUserId,
      },
      validation,
      stillCurrent
    ).finally(release);
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
