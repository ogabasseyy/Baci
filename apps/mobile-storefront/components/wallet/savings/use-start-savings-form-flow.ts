import type { SavingsFundingOption } from './start-savings.helpers';
import type {
  SavingsProductChoice,
  SavingsSourceMode,
} from './start-savings.types';
import { validateStartSavingsForm } from './start-savings-controller.utils';

import { primaryHeadStartRefusal } from './start-savings-wallet-balance';

export {
  PRIMARY_BALANCE_CHECK_FAILED_MESSAGE,
  PRIMARY_HEAD_START_ABOVE_TARGET_MESSAGE,
  PRIMARY_HEAD_START_SHORT_MESSAGE,
} from './start-savings-wallet-balance';

/**
 * Form-flow handlers for the start-savings form: preview validation,
 * funding continuation (manual vs auto-debit vs bank transfer), source
 * mode switching with hosted-staging guards, and plan-transfer
 * confirmation. Pure orchestration over controller state — no state of
 * its own.
 */
export const INTEREST_CHOICE_REQUIRED_MESSAGE =
  'Choose whether your plan earns interest.';
export const AUTO_DEBIT_UNAVAILABLE_MESSAGE =
  'Automatic saving isn’t available for your wallet yet. Save manually for now.';

export function useStartSavingsFormFlow({
  acceptsNonWithdrawableTerms,
  interestChoice,
  contributionValue,
  initialContributionEnabled,
  initialContributionValue,
  primaryWallet = false,
  autoDebitAllowed = true,
  refetch,
  selectedFundingOption,
  selectedPaymentMethodId,
  selectedProduct,
  setCreatedGoalId,
  setFormError,
  setInitialContributionAmount,
  setInitialContributionEnabled,
  setPaymentMethodsError,
  setShowPreviewModal,
  setShowSuccessModal,
  setShowTransferModal,
  setSourceMode,
  sourceMode,
  submitSavingsGoal,
  targetValue,
}: {
  acceptsNonWithdrawableTerms: boolean;
  /** PiggyVest plans only: the interest answer; null until chosen. */
  interestChoice?: boolean | null;
  contributionValue: number;
  initialContributionEnabled: boolean;
  initialContributionValue: number;
  /** The customer's spendable wallet is their PiggyVest main wallet. */
  primaryWallet?: boolean;
  /** False until the wallet is confirmed legacy (or for PiggyVest). */
  autoDebitAllowed?: boolean;
  refetch: () => Promise<unknown>;
  selectedFundingOption: SavingsFundingOption;
  selectedPaymentMethodId: string | null | undefined;
  selectedProduct: SavingsProductChoice | null;
  setCreatedGoalId: (value: string | null) => void;
  setFormError: (error: string | null) => void;
  setInitialContributionAmount: (value: string) => void;
  setInitialContributionEnabled: (value: boolean) => void;
  setPaymentMethodsError: (error: string | null) => void;
  setShowPreviewModal: (value: boolean) => void;
  setShowSuccessModal: (value: boolean) => void;
  setShowTransferModal: (value: boolean) => void;
  setSourceMode: (mode: SavingsSourceMode) => void;
  sourceMode: SavingsSourceMode;
  submitSavingsGoal: (options?: {
    deferInitialContribution?: boolean;
    continueInWallet?: boolean;
    confirmPrimaryBalance?: boolean;
  }) => Promise<void>;
  targetValue: number;
}) {
  const handleContinue = () => {
    const error = validateStartSavingsForm({
      acceptsNonWithdrawableTerms,
      contributionValue,
      initialContributionEnabled,
      initialContributionValue,
      paymentProvider: 'paystack',
      selectedProduct,
      sourceMode,
      targetValue,
    });
    const refusal =
      error ??
      (interestChoice === null ? INTEREST_CHOICE_REQUIRED_MESSAGE : null);
    setFormError(refusal);
    if (!refusal) {
      setShowPreviewModal(true);
    }
  };

  const confirmPlanTransfer = async () => {
    try {
      await refetch();
    } catch {
      // Best effort: the transfer lands asynchronously via reconciliation.
    }
    setShowTransferModal(false);
    setFormError(null);
    setCreatedGoalId(null);
    setShowSuccessModal(true);
  };

  const handleFundingContinue = async () => {
    if (sourceMode === 'auto_debit' && (primaryWallet || !autoDebitAllowed)) {
      setFormError(AUTO_DEBIT_UNAVAILABLE_MESSAGE);
      return;
    }
    if (sourceMode === 'auto_debit') {
      if (process.env.EXPO_PUBLIC_HOSTED_STOREFRONT === '1') {
        setPaymentMethodsError(
          'Auto debit is not available in this staging build.'
        );
        return;
      }
      if (!selectedPaymentMethodId) {
        setPaymentMethodsError(
          'Select a saved card or authorize a new Paystack card.'
        );
        return;
      }
      await submitSavingsGoal();
      return;
    }

    // The funding choice only exists for a legacy head start (it is not
    // shown for ₦0 or PiggyVest), so a hidden stale choice never applies.
    if (
      selectedFundingOption === 'bank_transfer' &&
      !primaryWallet &&
      initialContributionEnabled &&
      initialContributionValue > 0
    ) {
      await submitSavingsGoal({ deferInitialContribution: true });
      return;
    }

    // Plan creation can only debit the legacy wallet. A PiggyVest head start
    // is moved after the plan exists, from the wallet's Add to savings sheet
    // (which sets up the plan's savings wallet and asks for the wallet PIN).
    if (
      primaryWallet &&
      initialContributionEnabled &&
      initialContributionValue > 0
    ) {
      // Refuse up front rather than create a plan whose head start cannot
      // move: the legacy path fails atomically, so this path must too. The
      // plan is created without the head start, so check the target bound
      // the creation request would otherwise have enforced.
      // Whole naira (no silent rounding) and within the target, as the
      // submit step checks again on its own input.
      const refusal = primaryHeadStartRefusal(
        initialContributionValue,
        targetValue
      );
      if (refusal) {
        setFormError(refusal);
        return;
      }
      // The balance is confirmed fresh inside the guarded submission, so
      // a stand-in figure never refuses or allows the head start.
      await submitSavingsGoal({
        deferInitialContribution: true,
        continueInWallet: true,
        confirmPrimaryBalance: true,
      });
      return;
    }

    await submitSavingsGoal();
  };

  const handleSourceModeChange = (nextMode: SavingsSourceMode) => {
    // No card money goes into PiggyVest: manual is the only choice there.
    if (nextMode === 'auto_debit' && (primaryWallet || !autoDebitAllowed)) {
      setFormError(AUTO_DEBIT_UNAVAILABLE_MESSAGE);
      return;
    }
    if (
      nextMode === 'auto_debit' &&
      process.env.EXPO_PUBLIC_HOSTED_STOREFRONT === '1'
    ) {
      setFormError('Auto debit is not available in this staging build.');
      return;
    }
    setSourceMode(nextMode);
    setFormError(null);
    setPaymentMethodsError(null);
    if (nextMode === 'auto_debit') {
      setInitialContributionEnabled(false);
      setInitialContributionAmount('');
    }
  };

  return {
    confirmPlanTransfer,
    handleContinue,
    handleFundingContinue,
    handleSourceModeChange,
  };
}
