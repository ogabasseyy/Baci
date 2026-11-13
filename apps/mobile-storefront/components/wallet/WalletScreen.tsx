import { Redirect, router } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import { useWalletBalanceContractWarning } from '@/components/wallet/use-wallet-balance-contract-warning';
import { useWalletFundingAccountController } from '@/components/wallet/use-wallet-funding-account-controller';
import { useWalletRouteActionSetup } from '@/components/wallet/use-wallet-route-action-setup';
import { WalletScreenView } from '@/components/wallet/WalletScreenView';
import { useRequireAuth } from '@/hooks/use-auth-guard';
import {
  useCreateWalletFundingAccount,
  useRedeemPoints,
  useWallet,
} from '@/hooks/use-wallet';
import { useMerchantPaymentSettings } from '@/hooks/useMerchantPaymentSettings';
import { CONFIG } from '@/lib/config';
import { normalizeWalletFundAmountParam } from '@/lib/normalize-wallet-fund-amount-param';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { sanitizeWalletReturnTo } from '@/lib/sanitize-wallet-return-to';
import { useAuthStore } from '@/stores/auth-store';
import { createOpenSavingsShortfallFunding } from './open-savings-shortfall-funding';
import { SampleInterestPreview } from './SampleInterestPreview';
import { WalletPinSheet } from './savings/WalletPinSheet';
import { usePrimaryWalletWatch } from './use-primary-wallet-watch';
import { useWalletAppearance } from './use-wallet-appearance';
import { useWalletFundRedeemPanels } from './use-wallet-fund-redeem-panels';
import { useWalletSavedCards } from './use-wallet-saved-cards';
import { useWalletSavingsAmount } from './use-wallet-savings-amount';
import { useWalletSavingsController } from './use-wallet-savings-controller';
import { useWalletSavingsRefs } from './use-wallet-savings-refs';
import { useWalletSavingsSheetState } from './use-wallet-savings-sheet-state';
import {
  deriveWalletDisplayData,
  getWalletLoadingMessage,
  sanitizeWalletFundAmount,
} from './wallet-screen.helpers';
import type { WalletScreenProps } from './wallet-screen.types';
import { createSavingsGoalContentHandlers } from './wallet-screen-savings-goal-handlers';
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
  const { data, dataUpdatedAt, isError, isLoading, refetch, isRefetching } =
    useWallet({
      cachePolicy: 'display',
    });
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
  const {
    goalPin,
    isAddingSavingsContribution,
    setIsAddingSavingsContribution,
    setShowSavingsProgressModal,
    showSavingsProgressModal,
  } = useWalletSavingsSheetState(routeAction, savingsGoalId);
  const savingsRefs = useWalletSavingsRefs();
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
    },
    customerId: customer?.id,
    routeAction,
    routeSavingsGoalId: goalPin.routeGoalId,
    routeIntentId: Array.isArray(intent) ? intent[0] : intent,
    routeRequiredAmount,
    setFundAmount,
    setFundReturnTo,
    setShowFundPanel,
    setShowRedeemPanel,
    setShowSavingsProgressModal,
    walletReturnTo,
  });
  const wallet = usePrimaryWalletWatch({
    wallet: data?.wallet,
    showFundPanel,
    scopeKey: `${user?.id ?? ''}:${activeMerchantId ?? ''}`,
    refetch,
  });
  const display = wallet && deriveWalletDisplayData(wallet, goalPin.goalId);
  goalPin.noteShown(display?.activeSavingsGoal?.id);
  const {
    walletContentSavingsProps,
    handleAddSavingsContribution,
    handleFundSavingsWallet,
    handleOpenSavings,
    pinSheetProps,
  } = useWalletSavingsController({
    userId: user?.id,
    walletUpdatedAt: dataUpdatedAt,
    activeMerchantId,
    activeMerchantSlug,
    goal: display?.activeSavingsGoal ?? null,
    ...savingsRefs,
    onAddMoney: createOpenSavingsShortfallFunding({
      setFundReturnTo,
      setShowFundPanel,
      setShowSavingsProgressModal,
    }),
    primaryReady: display?.primaryReady ?? false,
    refetchWallet: refetch,
    savingsContributionAmount,
    legacyBalance: display?.legacyBalance,
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
  const loadingMessage = getWalletLoadingMessage({
    hasMerchantContext,
    hasWalletData: Boolean(data),
    isError,
    isLoading,
    user,
  });
  if (!user || !hasMerchantContext || isLoading || !data) {
    return (
      <WalletScreenView
        colors={colors}
        loadingMessage={loadingMessage}
        presentation={presentation}
      />
    );
  }
  const {
    activeSavingsGoal,
    earningsAvailable,
    earningsBalance,
    fundingAccount,
    savingsBalance,
    showQuickSave,
    spendableBalance,
    totalBalance,
  } = display ?? deriveWalletDisplayData(data.wallet, goalPin.goalId);
  return (
    <>
      <WalletScreenView
        colors={colors}
        presentation={presentation}
        walletContentProps={{
          activeSavingsGoal,
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
          ...walletContentSavingsProps,
          isCreatingFundingAccount: createFundingAccountMutation.isPending,
          isFundPending,
          isRedeemPending: redeemMutation.isPending,
          isRefetching,
          loyaltyPoints: data.wallet.loyalty_points,
          needsPhone,
          primaryReady: display?.primaryReady ?? false,
          onAddSavingsContribution: handleAddSavingsContribution,
          ...createSavingsGoalContentHandlers({
            activeMerchantId,
            activeMerchantSlug,
            goal: activeSavingsGoal,
            refetchWallet: refetch,
          }),
          onChangeSavingsContributionAmount: (value) =>
            setSavingsContributionAmount(sanitizeWalletFundAmount(value)),
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
          pinPrompt: <WalletPinSheet colors={colors} {...pinSheetProps} />,
          redeemPoints,
          savingsContributionAmount,
          savingsBalance,
          spendableBalance,
          showSavingsProgress: showSavingsProgressModal,
          showQuickSave,
          showFundPanel,
          showRedeemPanel,
          totalBalance,
          transactions: data.transactions,
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
