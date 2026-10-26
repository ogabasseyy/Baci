import { Redirect, router } from 'expo-router';
import { useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useWalletBalanceContractWarning } from '@/components/wallet/use-wallet-balance-contract-warning';
import { useWalletFundingAccountController } from '@/components/wallet/use-wallet-funding-account-controller';
import { useWalletRouteActionSetup } from '@/components/wallet/use-wallet-route-action-setup';
import { WalletScreenView } from '@/components/wallet/WalletScreenView';
import { useRequireAuth } from '@/hooks/use-auth-guard';
import {
  useCreateWalletFundingAccount,
  useRedeemPoints,
} from '@/hooks/use-wallet';
import { useMerchantPaymentSettings } from '@/hooks/useMerchantPaymentSettings';
import { CONFIG } from '@/lib/config';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { normalizeWalletFundAmountParam } from '@/lib/normalize-wallet-fund-amount-param';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { sanitizeWalletReturnTo } from '@/lib/sanitize-wallet-return-to';
import { useAuthStore } from '@/stores/auth-store';
import { SampleInterestPreview } from './SampleInterestPreview';
import { useWalletAppearance } from './use-wallet-appearance';
import { useWalletFundRedeemPanels } from './use-wallet-fund-redeem-panels';
import { useWalletSavedCards } from './use-wallet-saved-cards';
import { useWalletSavingsAmount } from './use-wallet-savings-amount';
import { useWalletSavingsController } from './use-wallet-savings-controller';
import { useWalletScreenData } from './use-wallet-screen-data';
import { WalletLoadingView } from './WalletLoadingView';
import {
  deriveWalletDisplayData,
  sanitizeWalletFundAmount,
} from './wallet-screen.helpers';
import type { WalletScreenProps } from './wallet-screen.types';
import {
  changeSavingsGoalDevice,
  createSavingsVariantResolutionHandler,
} from './wallet-screen-savings.handlers';
export function WalletScreen({
  action,
  intent,
  presentation = 'stack',
  requiredAmount,
  returnTo,
  savingsAmount,
  savingsGoalId,
}: WalletScreenProps = {}) {
  const { colors, scrollContentStyle } = useWalletAppearance(presentation);
  const routeAction = Array.isArray(action) ? action[0] : action;
  const routeSavingsGoalId = Array.isArray(savingsGoalId)
    ? savingsGoalId[0]
    : savingsGoalId;
  const routeRequiredAmount = normalizeWalletFundAmountParam(requiredAmount);
  const walletReturnTo = sanitizeWalletReturnTo(returnTo);
  const { isLoading: authLoading, redirectTo } = useRequireAuth();
  const { customer, merchantId, updateProfile, user } = useAuthStore(
    useShallow((state) => ({
      customer: state.customer,
      merchantId: state.merchantId,
      updateProfile: state.updateProfile,
      user: state.user,
    }))
  );
  const walletQuery = useWalletScreenData();
  const { data, isLoading, refetch, isRefetching, refreshState } = walletQuery;
  const {
    data: paymentSettings,
    isError: isPaymentSettingsError,
    isPending: isPaymentSettingsQueryPending,
  } = useMerchantPaymentSettings();
  const redeemMutation = useRedeemPoints();
  const createFundingAccountMutation = useCreateWalletFundingAccount();
  const activeMerchantId =
    pickMerchantId(merchantId, CONFIG.MERCHANT_ID) ?? undefined;
  const {
    fundAmount,
    fundReturnTo,
    handleFundWallet,
    handleRedeemPoints,
    isFundPending,
    redeemPoints,
    resetFundPanel,
    resetRedeemPanel,
    setFundAmount,
    setFundReturnTo,
    setIsFundPending,
    setRedeemPoints,
    setShowFundPanel,
    setShowRedeemPanel,
    showFundPanel,
    showRedeemPanel,
  } = useWalletFundRedeemPanels({
    activeMerchantId,
    activeMerchantSlug: CONFIG.MERCHANT_SLUG?.trim() || undefined,
    customer,
    redeemPointsMutation: redeemMutation.mutateAsync,
    refetchWalletBalance: refetch,
    routeAction,
    routeRequiredAmount,
    user,
    walletReturnTo,
  });
  const [savingsContributionAmount, setSavingsContributionAmount] =
    useWalletSavingsAmount(routeAction, savingsAmount);
  const [showSavingsProgressModal, setShowSavingsProgressModal] = useState(
    routeAction === 'savings'
  );
  const [isAddingSavingsContribution, setIsAddingSavingsContribution] =
    useState(false);
  const savingsContributionIdempotencyKeyRef = useRef<string | null>(null);
  const hasSavedCards = useWalletSavedCards(customer?.id, activeMerchantId);
  const activeMerchantSlug = CONFIG.MERCHANT_SLUG?.trim() || undefined;
  const hasMerchantContext = Boolean(activeMerchantId || activeMerchantSlug);
  const {
    canCreateFundingAccount,
    createFundingAccountUnavailableMessage,
    needsPhone,
    onCreateFundingAccount: handleCreateFundingAccount,
    onSubmitPhone: handleSubmitPhone,
  } = useWalletFundingAccountController({
    activeMerchantId,
    activeMerchantSlug,
    createFundingAccount: createFundingAccountMutation.mutateAsync,
    customerId: customer?.id,
    customerPhone: customer?.phone,
    isPaymentSettingsError,
    isPaymentSettingsPending: isPaymentSettingsQueryPending,
    paymentSettings,
    setShowFundPanel,
    updateProfile,
  });
  useWalletBalanceContractWarning({
    merchantId: activeMerchantId,
    ownerId: customer?.id ?? user?.id ?? '',
    walletData: data?.wallet,
  });
  const isWalletFundingSessionReady = useWalletRouteActionSetup({
    bankTransfer: {
      canCreateFundingAccount,
      createFundingAccount: handleCreateFundingAccount,
      hasFundingAccount: Boolean(data?.wallet?.funding_account),
      hasWalletData: Boolean(data),
      isCreating: createFundingAccountMutation.isPending,
      needsPhone,
      openPanel: isPiggyvestPrimaryMerchant(activeMerchantId),
    },
    customerId: customer?.id,
    routeAction,
    routeSavingsGoalId,
    routeIntentId: Array.isArray(intent) ? intent[0] : intent,
    routeRequiredAmount,
    setFundAmount,
    setFundReturnTo,
    setShowFundPanel,
    setShowRedeemPanel,
    setShowSavingsProgressModal,
    walletReturnTo,
  });
  const display =
    data && deriveWalletDisplayData(data.wallet, routeSavingsGoalId);
  const {
    hasPendingSavingsContribution,
    handleAddSavingsContribution,
    handleFundSavingsWallet,
    handleOpenSavings,
  } = useWalletSavingsController({
    userId: user?.id,
    activeMerchantId,
    activeMerchantSlug,
    goal: display?.activeSavingsGoal ?? null,
    idempotencyKeyRef: savingsContributionIdempotencyKeyRef,
    refetchWallet: refetch,
    savingsContributionAmount,
    spendableBalance: display?.spendableBalance ?? 0,
    walletTopUp: { customer, user, setIsFundPending },
    setIsAddingSavingsContribution,
    setShowSavingsProgressModal,
    setSavingsContributionAmount,
  });
  if (authLoading) {
    return <WalletScreenView colors={colors} presentation={presentation} />;
  }
  if (redirectTo) {
    return <Redirect href={redirectTo} />;
  }
  if (!user || !hasMerchantContext || isLoading || !data) {
    return (
      <WalletLoadingView
        colors={colors}
        query={walletQuery}
        user={user}
        hasMerchantContext={hasMerchantContext}
        presentation={presentation}
      />
    );
  }
  const { wallet: walletData, transactions } = data;
  const {
    activeSavingsGoal,
    earningsAvailable,
    earningsBalance,
    fundingAccount,
    savingsBalance,
    showQuickSave,
    spendableBalance,
    totalBalance,
  } = display ?? deriveWalletDisplayData(walletData, routeSavingsGoalId);
  return (
    <>
      <WalletScreenView
        colors={colors}
        presentation={presentation}
        walletContentProps={{
          activeSavingsGoal,
          savingsGoals: walletData.savings_goals,
          hasSavedCards,
          canCreateFundingAccount,
          contentContainerStyle: scrollContentStyle,
          createFundingAccountUnavailableMessage,
          customerId: customer?.id,
          merchantId: activeMerchantId,
          canResolveCreditBaseline: isWalletFundingSessionReady,
          earningsAvailable,
          earningsBalance,
          fundAmount,
          fundReturnTo,
          fundingAccount,
          isAddingSavingsContribution,
          hasPendingSavingsContribution,
          isCreatingFundingAccount: createFundingAccountMutation.isPending,
          isFundPending,
          isRedeemPending: redeemMutation.isPending,
          isRefetching,
          refreshState,
          loyaltyPoints: walletData.loyalty_points,
          needsPhone,
          onAddSavingsContribution: handleAddSavingsContribution,
          onChangeSavingsDevice: (product, variantId) =>
            changeSavingsGoalDevice({
              activeMerchantId,
              activeMerchantSlug,
              goal: activeSavingsGoal,
              product,
              refetchWallet: refetch,
              variantId,
            }),
          onChangeSavingsContributionAmount: (value) =>
            setSavingsContributionAmount(sanitizeWalletFundAmount(value)),
          onResolveSavingsVariant: createSavingsVariantResolutionHandler({
            activeMerchantId,
            activeMerchantSlug,
            goal: activeSavingsGoal,
            refetchWallet: refetch,
          }),
          onChangeFundAmount: (value) =>
            setFundAmount(sanitizeWalletFundAmount(value)),
          onCreateFundingAccount: handleCreateFundingAccount,
          onChangeRedeemPoints: setRedeemPoints,
          onCloseSavingsProgress: () => setShowSavingsProgressModal(false),
          onConfirmFund: handleFundWallet,
          onConfirmRedeem: handleRedeemPoints,
          onFundSavingsWallet: handleFundSavingsWallet,
          onManageCards: () => router.push('/wallet/manage-cards'),
          onOpenFundPanel: () => setShowFundPanel(true),
          onOpenRedeemPanel: () => setShowRedeemPanel(true),
          onQuickSave: handleOpenSavings,
          onRefresh: refetch,
          onResetFund: resetFundPanel,
          onResetRedeem: resetRedeemPanel,
          onStartSavings: handleOpenSavings,
          onSubmitPhone: handleSubmitPhone,
          redeemPoints,
          savingsContributionAmount,
          savingsBalance,
          spendableBalance,
          showSavingsProgress: showSavingsProgressModal,
          showQuickSave,
          showFundPanel,
          showRedeemPanel,
          totalBalance,
          transactions,
        }}
      />
      <SampleInterestPreview
        colors={colors}
        goal={activeSavingsGoal}
        ownerId={customer?.id ?? user.id}
        presentation={presentation}
      />
    </>
  );
}
