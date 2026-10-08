import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useWallet } from '@/hooks/use-wallet';
import { CONFIG } from '@/lib/config';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { useAuthStore } from '@/stores/auth-store';
import {
  calculateMaturityDate,
  formatDateInput,
  getEffectiveInitialContribution,
  getRequiredTopUp,
  getTodayIsoDate,
  normalizeAmountInput,
  parseAmount,
  type SavingsFrequency,
  type SavingsFundingOption,
} from './start-savings.helpers';
import type {
  SavingsSearchParams,
  SavingsSourceMode,
} from './start-savings.types';
import { readParam } from './start-savings-controller.utils';
import { useSavingsPlanFunding } from './use-savings-plan-funding';
import { useStartSavingsFormFlow } from './use-start-savings-form-flow';
import { useStartSavingsPaymentMethods } from './use-start-savings-payment-methods';
import { useStartSavingsProductSearch } from './use-start-savings-product-search';
import { useStartSavingsProductSelection } from './use-start-savings-product-selection';
import { useStartSavingsSubmit } from './use-start-savings-submit';
import { useStartSavingsVariantSelection } from './use-start-savings-variant-selection';

const DEFAULT_PREFERRED_DEBIT_TIME = '06:20';

export function useStartSavingsController() {
  const [goalIdempotencyKey, setGoalIdempotencyKey] = useState<string | null>(
    null
  );
  const params = useLocalSearchParams<SavingsSearchParams>();
  const { merchantId } = useAuthStore(
    useShallow((state) => ({ merchantId: state.merchantId }))
  );
  const { data: walletData, isRefetching, refetch } = useWallet();
  const [searchValue, setSearchValue] = useState('');
  const [contributionAmount, setContributionAmount] = useState('');
  const [frequency, setFrequency] = useState<SavingsFrequency>('daily');
  const [preferredDebitTime, setPreferredDebitTime] = useState(
    DEFAULT_PREFERRED_DEBIT_TIME
  );
  const [startDate, setStartDate] = useState(getTodayIsoDate());
  const [initialContributionEnabled, setInitialContributionEnabled] =
    useState(false);
  const [initialContributionAmount, setInitialContributionAmount] =
    useState('');
  const [
    initialContributionIdempotencyKey,
    setInitialContributionIdempotencyKey,
  ] = useState<string | null>(null);
  const [acceptsNonWithdrawableTerms, setAcceptsNonWithdrawableTerms] =
    useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showFundingModal, setShowFundingModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [createdGoalId, setCreatedGoalId] = useState<string | null>(null);
  const [selectedFundingOption, setSelectedFundingOption] =
    useState<SavingsFundingOption>('wallet');
  const [sourceMode, setSourceMode] = useState<SavingsSourceMode>('manual');
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
  const safeWalletBalance = walletData?.wallet.balance ?? 0;
  const fundingAccount = walletData?.wallet.funding_account ?? null;

  const routeVariantId = readParam(params.variantId);
  const { selectVariantOption, variantOptionGroups } =
    useStartSavingsVariantSelection({
      clearProductSelection,
      routeVariantId,
      searchValue,
      selectedCatalogProduct,
      selectedProduct,
      selectProduct,
    });
  const contributionValue = parseAmount(contributionAmount);
  const targetValue =
    selectedProduct && !selectedProduct.requiresVariantSelection
      ? selectedProduct.price
      : 0;
  const targetAmount = targetValue > 0 ? String(targetValue) : '';
  const initialContributionValue = parseAmount(initialContributionAmount);
  const maturityDate =
    calculateMaturityDate({
      contributionAmount: contributionValue,
      frequency,
      startDate,
      targetAmount: targetValue,
    }) ?? '';
  const effectiveInitialContribution = getEffectiveInitialContribution({
    contributionAmount: contributionValue,
    fundingOption: selectedFundingOption,
    initialContributionAmount: initialContributionValue,
    initialContributionEnabled,
  });
  const requiredTopUpAmount = getRequiredTopUp({
    availableBalance: safeWalletBalance,
    requiredContribution: effectiveInitialContribution,
  });
  const {
    fetchExistingPlanFunding,
    fetchPlanFunding,
    fundingError: planFundingError,
    planFundingAccounts,
    planFundingPhase,
    planFundingStatusCode,
    planFundingRequiresBvn,
  } = useSavingsPlanFunding({
    activeMerchantId: activeMerchantId ?? undefined,
    activeMerchantSlug,
    goalId: createdGoalId,
  });
  const {
    goToWallet,
    handleAuthorizeSavingsCard,
    handleCopyFundingAccount,
    isAuthorizingCard,
    isSubmitting,
    openWalletFundingScreen,
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
    initialContributionIdempotencyKey,
    maturityDate,
    goalIdempotencyKey,
    setGoalIdempotencyKey,
    preferredDebitTime,
    refetch,
    requiredTopUpAmount,
    selectedPaymentMethodId,
    selectedProduct,
    setFormError,
    setInitialContributionIdempotencyKey,
    setShowFundingModal,
    setShowPreviewModal,
    setShowSuccessModal,
    setShowTransferModal,
    sourceMode,
    startDate,
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
  });

  return {
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
    planFundingAccounts,
    planFundingError,
    planFundingPhase,
    planFundingStatusCode,
    planFundingRequiresBvn,
    preferredDebitTime,
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
    setShowFundingModal,
    setShowPreviewModal,
    setStartDate: (value: string) => setStartDate(formatDateInput(value)),
    showFundingModal,
    showPreviewModal,
    showSuccessModal,
    showTransferModal,
    sourceMode,
    startDate,
    submitSavingsGoal,
    targetAmount,
    targetValue,
    variantOptionGroups,
    variantOptions,
  };
}
