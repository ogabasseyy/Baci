import type { SavingsFundingOption } from './start-savings.helpers';
import type {
  SavingsProductChoice,
  SavingsSourceMode,
} from './start-savings.types';
import { validateStartSavingsForm } from './start-savings-controller.utils';

/**
 * Form-flow handlers for the start-savings form: preview validation,
 * funding continuation (manual vs auto-debit vs bank transfer), source
 * mode switching with hosted-staging guards, and plan-transfer
 * confirmation. Pure orchestration over controller state — no state of
 * its own.
 */
export function useStartSavingsFormFlow({
  acceptsNonWithdrawableTerms,
  contributionValue,
  initialContributionEnabled,
  initialContributionValue,
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
  contributionValue: number;
  initialContributionEnabled: boolean;
  initialContributionValue: number;
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
    setFormError(error);
    if (!error) {
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

    if (selectedFundingOption === 'bank_transfer') {
      await submitSavingsGoal({ deferInitialContribution: true });
      return;
    }

    await submitSavingsGoal();
  };

  const handleSourceModeChange = (nextMode: SavingsSourceMode) => {
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
