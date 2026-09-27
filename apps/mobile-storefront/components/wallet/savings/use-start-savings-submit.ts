import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { showAppAlert } from '@/components/ui/show-app-alert';
import { setClipboardString } from '@/lib/clipboard';
import { initializeSavingsAuthorization } from '@/lib/customer-savings';
import { WALLET_TOP_UP_MIN_AMOUNT } from '@/lib/wallet-top-up-constants';
import {
  runSavingsGoalSubmission,
  type UseStartSavingsSubmitInput,
} from './run-savings-goal-submission';
import { formatDateInput } from './start-savings.helpers';
import type { SavingsProductChoice } from './start-savings.types';
import { getErrorMessage } from './start-savings-controller.utils';

// Standard authorization amount used for card verification.
const CARD_AUTHORIZATION_AMOUNT = 100;

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

/**
 * Starts the Paystack card authorization flow. Lives at module scope (outside
 * the hook render) so its try/catch does not block React Compiler memoization
 * of the hook.
 */
async function runSavingsCardAuthorization(
  input: UseStartSavingsSubmitInput
): Promise<void> {
  try {
    const result = await initializeSavingsAuthorization({
      amount: CARD_AUTHORIZATION_AMOUNT,
      merchantId: input.activeMerchantId,
      merchantSlug: input.activeMerchantSlug,
    });
    input.setShowFundingModal(false);
    router.push({
      pathname: '/payment-gateway',
      params: {
        authorizationUrl: result.authorization_url,
        gateway: result.gateway,
        merchantId: input.activeMerchantId,
        merchantSlug: input.activeMerchantSlug,
        paymentKind: 'savings_auth',
        reference: result.reference,
        returnTo: '/wallet/savings/start',
      },
    });
  } catch (error) {
    showAppAlert({
      title: 'Unable to authorize card',
      message: getErrorMessage(
        error,
        'Unable to start Paystack card authorization.'
      ),
      variant: 'error',
    });
  }
}

export function useStartSavingsSubmit(input: UseStartSavingsSubmitInput) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAuthorizingCard, setIsAuthorizingCard] = useState(false);
  const authorizationInFlightRef = useRef(false);
  const submitInFlightRef = useRef(false);

  const submitSavingsGoal = async () => {
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
    await runSavingsGoalSubmission(input, validation).finally(() => {
      submitInFlightRef.current = false;
      setIsSubmitting(false);
    });
  };

  const handleAuthorizeSavingsCard = async () => {
    if (authorizationInFlightRef.current) {
      return;
    }

    authorizationInFlightRef.current = true;
    setIsAuthorizingCard(true);
    await runSavingsCardAuthorization(input).finally(() => {
      authorizationInFlightRef.current = false;
      setIsAuthorizingCard(false);
    });
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
