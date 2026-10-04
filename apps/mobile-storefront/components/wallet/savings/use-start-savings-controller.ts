import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useProductSearch } from '@/hooks/use-product-search';
import { useWallet } from '@/hooks/use-wallet';
import { CONFIG } from '@/lib/config';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { useAuthStore } from '@/stores/auth-store';
import type { Product } from '@/types/product';
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
import {
  readParam,
  validateStartSavingsForm,
} from './start-savings-controller.utils';
import {
  buildSavingsVariantOptionGroups,
  completeSavingsSingleValueSelection,
  resolveSavingsVariant,
  type SavingsVariantSelection,
  seedSavingsVariantSelection,
  selectSavingsVariantOption,
} from './start-savings-variant-options';
import { useSavingsPlanFunding } from './use-savings-plan-funding';
import { useStartSavingsPaymentMethods } from './use-start-savings-payment-methods';
import { useStartSavingsProductSelection } from './use-start-savings-product-selection';
import { useStartSavingsSubmit } from './use-start-savings-submit';

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
  const [selectedProductSource, setSelectedProductSource] =
    useState<Product | null>(null);
  const [variantSelection, setVariantSelection] =
    useState<SavingsVariantSelection>({});
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
  const debouncedSearch = searchValue;
  const {
    products,
    isLoading: isProductsLoading,
    resolveProduct,
  } = useProductSearch({
    enabled: Boolean(debouncedSearch.trim() || readParam(params.productId)),
    limit: 8,
    search: debouncedSearch.trim() ? debouncedSearch.trim() : undefined,
  });
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

  const selectVariantOption = (axis: string, value: string) => {
    const variants = selectedProductSource?.variants ?? [];
    if (!selectedProductSource || variants.length === 0) {
      return;
    }
    const selection = selectSavingsVariantOption(
      variants,
      variantSelection,
      axis,
      value
    );
    const resolvedVariant = resolveSavingsVariant(variants, selection);
    setVariantSelection(selection);
    selectProduct(selectedProductSource, resolvedVariant?.id ?? null);
  };

  const routeVariantId = readParam(params.variantId);
  useEffect(() => {
    if (!selectedCatalogProduct) {
      return;
    }
    const variants = selectedCatalogProduct.variants ?? [];
    setSelectedProductSource(selectedCatalogProduct);
    setVariantSelection(
      completeSavingsSingleValueSelection(
        variants,
        seedSavingsVariantSelection(variants, routeVariantId)
      )
    );
  }, [routeVariantId, selectedCatalogProduct]);
  useEffect(() => {
    if (!selectedProduct || searchValue === selectedProduct.name) {
      return;
    }
    clearProductSelection();
    setSelectedProductSource(null);
    setVariantSelection({});
  }, [clearProductSelection, searchValue, selectedProduct]);
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
    fetchPlanFunding,
    fundingError: planFundingError,
    planFundingAccounts,
    planFundingPhase,
    planFundingStatusCode,
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
    acceptsNonWithdrawableTerms,
    confirmPlanTransfer,
    contributionAmount,
    contributionValue,
    createdGoalId,
    debouncedSearch,
    effectiveInitialContribution,
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
    variantOptionGroups: buildSavingsVariantOptionGroups(
      selectedProductSource?.variants ?? [],
      variantSelection
    ),
    variantOptions,
  };
}
