import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useWallet } from '@/hooks/use-wallet';
import { CONFIG } from '@/lib/config';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { useAuthStore } from '@/stores/auth-store';
import { useSavingsTermsAcceptance } from './savings-terms-acceptance';
import {
  deriveStartSavingsAmounts,
  formatDateInput,
  getTodayIsoDate,
  normalizeAmountInput,
  type SavingsFrequency,
  type SavingsFundingOption,
} from './start-savings.helpers';
import type {
  SavingsSearchParams,
  SavingsSourceMode,
} from './start-savings.types';
import { readParam } from './start-savings-controller.utils';
import { resolveStartSavingsWalletBalance } from './start-savings-wallet-balance';
import { useInitialContributionOperation } from './use-initial-contribution-operation';
import { useSavingsPlanFunding } from './use-savings-plan-funding';
import { useStartSavingsAccountReset } from './use-start-savings-account-reset';
import { useStartSavingsFormFlow } from './use-start-savings-form-flow';
import { useStartSavingsPaymentMethods } from './use-start-savings-payment-methods';
import { useStartSavingsPrimarySetup } from './use-start-savings-primary-setup';
import { useStartSavingsProductSearch } from './use-start-savings-product-search';
import { useStartSavingsProductSelection } from './use-start-savings-product-selection';
import { useStartSavingsSheets } from './use-start-savings-sheets';
import { useStartSavingsSubmit } from './use-start-savings-submit';
import { useStartSavingsVariantSelection } from './use-start-savings-variant-selection';

export function useStartSavingsController() {
  const [goalIdempotencyKey, setGoalIdempotencyKey] = useState<string | null>(
    null
  );
  const params = useLocalSearchParams<SavingsSearchParams>();
  const { merchantId, userId } = useAuthStore(
    useShallow((state) => ({
      merchantId: state.merchantId,
      userId: state.user?.id,
    }))
  );
  const { data: walletData, isRefetching, refetch } = useWallet();
  const [searchValue, setSearchValue] = useState('');
  const [contributionAmount, setContributionAmount] = useState('');
  const [frequency, setFrequency] = useState<SavingsFrequency>('daily');
  // A round default reminder time; the customer can change it.
  const [preferredDebitTime, setPreferredDebitTime] = useState('08:00');
  const [startDate, setStartDate] = useState(getTodayIsoDate());
  const [initialContributionEnabled, setInitialContributionEnabled] =
    useState(false);
  const [initialContributionAmount, setInitialContributionAmount] =
    useState('');
  const operation = useInitialContributionOperation();
  const [formError, setFormError] = useState<string | null>(null);
  const [acceptsNonWithdrawableTerms, setAcceptsNonWithdrawableTerms] =
    useSavingsTermsAcceptance(setFormError);
  const sheets = useStartSavingsSheets();
  const [createdGoalId, setCreatedGoalId] = useState<string | null>(null);
  const [selectedFundingOption, setSelectedFundingOption] =
    useState<SavingsFundingOption>('wallet');
  const [chosenSourceMode, setSourceMode] =
    useState<SavingsSourceMode>('manual');
  const { debouncedSearch, isProductsLoading, products, resolveProduct } =
    useStartSavingsProductSearch({ params, searchValue });
  const {
    clearProductSelection,
    selectProduct,
    selectVariant,
    selectedCatalogProduct,
    selectedProduct,
    variantOptions,
  } = useStartSavingsProductSelection({
    params,
    products,
    resolveProduct,
    setFormError,
    setSearchValue,
  });
  const activeMerchantId = pickMerchantId(merchantId, CONFIG.MERCHANT_ID);
  const activeMerchantSlug = CONFIG.MERCHANT_SLUG?.trim() || undefined;
  const { balance: safeWalletBalance, primaryWallet } =
    resolveStartSavingsWalletBalance(walletData?.wallet);
  const primarySetup = useStartSavingsPrimarySetup({
    activeMerchantId: activeMerchantId ?? undefined,
    primaryWallet,
    userId,
    wallet: walletData?.wallet,
  });
  const sourceMode: SavingsSourceMode = primarySetup.allowAutoDebit
    ? chosenSourceMode
    : 'manual';
  const {
    isLoadingPaymentMethods,
    paymentMethodsError,
    savedPaymentMethods,
    selectedPaymentMethodId,
    setPaymentMethodsError,
    setSelectedPaymentMethodId,
  } = useStartSavingsPaymentMethods({
    activeMerchantId: activeMerchantId ?? undefined,
    activeMerchantSlug,
    sourceMode,
  });
  const fundingAccount = walletData?.wallet.funding_account ?? null;
  const { selectVariantOption, variantOptionGroups } =
    useStartSavingsVariantSelection({
      clearProductSelection,
      routeVariantId: readParam(params.variantId),
      searchValue,
      selectedCatalogProduct,
      selectedProduct,
      selectProduct,
    });
  const {
    contributionValue,
    targetValue,
    targetAmount,
    initialContributionValue,
    maturityDate,
    effectiveInitialContribution,
    requiredTopUpAmount,
  } = deriveStartSavingsAmounts({
    contributionAmount,
    frequency,
    initialContributionAmount,
    initialContributionEnabled,
    safeWalletBalance,
    selectedFundingOption,
    selectedProduct,
    startDate,
  });
  useStartSavingsAccountReset(userId, {
    setCreatedGoalId,
    setGoalIdempotencyKey,
    setInitialContributionIdempotencyKey:
      operation.setInitialContributionIdempotencyKey,
    setFormError,
    ...sheets,
  });
  const {
    fetchExistingPlanFunding,
    fetchPlanFunding,
    fundingError: planFundingError,
    planFundingPhase,
    planFundingStatusCode,
    planFundingRequiresBvn,
  } = useSavingsPlanFunding({
    activeMerchantId: activeMerchantId ?? undefined,
    activeMerchantSlug,
    goalId: createdGoalId,
    identityKey: userId,
  });
  const {
    goToWallet,
    handleAuthorizeSavingsCard,
    handleCopyFundingAccount,
    isAuthorizingCard,
    isSubmitting,
    openWalletFundingScreen,
    pinSheetProps,
    submitBankTransferContribution,
    submitSavingsGoal,
  } = useStartSavingsSubmit({
    activeMerchantId: activeMerchantId ?? undefined,
    activeMerchantSlug,
    contributionValue,
    createdGoalId,
    effectiveInitialContribution,
    frequency,
    fundingAccount,
    setCreatedGoalId,
    ...operation,
    maturityDate,
    goalIdempotencyKey,
    setGoalIdempotencyKey,
    preferredDebitTime,
    refetch,
    requiredTopUpAmount,
    selectedPaymentMethodId,
    selectedProduct,
    setFormError,
    ...sheets,
    sourceMode,
    startDate,
    startGoalWalletSetup: primarySetup.startGoalWalletSetup,
    acceptsNonWithdrawableTerms,
    interestChoice: primarySetup.formInterestChoice,
    primaryRail: primarySetup.askInterest,
    targetValue,
    variantId: selectedProduct?.variantId ?? null,
  });
  const {
    confirmPlanTransfer,
    handleContinue,
    handleFundingContinue,
    handleSourceModeChange,
  } = useStartSavingsFormFlow({
    acceptsNonWithdrawableTerms,
    interestChoice: primarySetup.formInterestChoice,
    contributionValue,
    initialContributionEnabled,
    initialContributionValue,
    primaryWallet: primarySetup.askInterest,
    autoDebitAllowed: primarySetup.allowAutoDebit,
    refetch,
    selectedFundingOption,
    selectedPaymentMethodId,
    selectedProduct,
    setCreatedGoalId,
    setFormError,
    setInitialContributionAmount,
    setInitialContributionEnabled,
    setPaymentMethodsError,
    ...sheets,
    setSourceMode,
    sourceMode,
    submitSavingsGoal,
    targetValue,
  });
  return {
    ...primarySetup,
    ...sheets,
    acceptsNonWithdrawableTerms,
    confirmPlanTransfer,
    contributionAmount,
    contributionValue,
    createdGoalId,
    debouncedSearch,
    effectiveInitialContribution,
    fetchExistingPlanFunding,
    fetchPlanFunding,
    formError,
    frequency,
    fundingAccount,
    goToWallet,
    handleAuthorizeSavingsCard,
    handleContinue,
    handleCopyFundingAccount,
    handleFundingContinue,
    handleSourceModeChange,
    initialContributionAmount,
    initialContributionEnabled,
    isAuthorizingCard,
    isLoadingPaymentMethods,
    isProductsLoading,
    isRefetching,
    isSubmitting,
    maturityDate,
    openWalletFundingScreen,
    paymentMethodsError,
    pinSheetProps,
    planFundingError,
    planFundingPhase,
    planFundingStatusCode,
    planFundingRequiresBvn,
    preferredDebitTime,
    primaryWallet: primarySetup.askInterest,
    products,
    refetch,
    requiredTopUpAmount,
    safeWalletBalance,
    savedPaymentMethods,
    searchValue,
    selectProduct,
    selectedCatalogProduct,
    selectVariant,
    selectVariantOption,
    selectedFundingOption,
    selectedPaymentMethodId,
    selectedProduct,
    submitBankTransferContribution,
    setAcceptsNonWithdrawableTerms,
    setContributionAmount: (value: string) => {
      setFormError(null);
      setContributionAmount(normalizeAmountInput(value));
    },
    setFrequency,
    setInitialContributionAmount: (value: string) =>
      setInitialContributionAmount(normalizeAmountInput(value)),
    setInitialContributionEnabled,
    setPaymentMethodsError,
    setPreferredDebitTime,
    setSearchValue,
    setSelectedFundingOption,
    setSelectedPaymentMethodId,
    setStartDate: (value: string) => setStartDate(formatDateInput(value)),
    sourceMode,
    startDate,
    submitSavingsGoal,
    targetAmount,
    targetValue,
    variantOptionGroups,
    variantOptions,
  };
}
