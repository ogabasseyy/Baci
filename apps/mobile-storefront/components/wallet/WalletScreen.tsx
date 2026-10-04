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
  useWallet,
} from '@/hooks/use-wallet';
import { useMerchantPaymentSettings } from '@/hooks/useMerchantPaymentSettings';
import { CONFIG } from '@/lib/config';
import { normalizeWalletFundAmountParam } from '@/lib/normalize-wallet-fund-amount-param';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { sanitizeWalletReturnTo } from '@/lib/sanitize-wallet-return-to';
import { useAuthStore } from '@/stores/auth-store';
import { SampleInterestPreview } from './SampleInterestPreview';
import { useWalletAppearance } from './use-wallet-appearance';
import { useWalletSavedCards } from './use-wallet-saved-cards';
import { createWalletSavingsActions } from './use-wallet-savings-actions';
import { useWalletSavingsAmount } from './use-wallet-savings-amount';
import { fundWallet, redeemWalletPoints } from './wallet-screen.handlers';
import {
  deriveWalletDisplayData,
  getWalletLoadingMessage,
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
  const { data, isError, isLoading, refetch, isRefetching } = useWallet({
    cachePolicy: 'display',
  });
  const {
    data: paymentSettings,
    isError: isPaymentSettingsError,
    isPending: isPaymentSettingsQueryPending,
  } = useMerchantPaymentSettings();
  const redeemMutation = useRedeemPoints();
  const createFundingAccountMutation = useCreateWalletFundingAccount();
  const [redeemPoints, setRedeemPoints] = useState('');
  const [showRedeemPanel, setShowRedeemPanel] = useState(
    routeAction === 'redeem'
  );
  const [fundAmount, setFundAmount] = useState(routeRequiredAmount);
  const [showFundPanel, setShowFundPanel] = useState(routeAction === 'fund');
  const [isFundPending, setIsFundPending] = useState(false);
  const [savingsContributionAmount, setSavingsContributionAmount] =
    useWalletSavingsAmount(routeAction, savingsAmount);
  const [showSavingsProgressModal, setShowSavingsProgressModal] = useState(
    routeAction === 'savings'
  );
  const [isAddingSavingsContribution, setIsAddingSavingsContribution] =
    useState(false);
  const savingsContributionIdempotencyKeyRef = useRef<string | null>(null);
  const [fundReturnTo, setFundReturnTo] = useState(walletReturnTo);
  const activeMerchantId =
    pickMerchantId(merchantId, CONFIG.MERCHANT_ID) ?? undefined;
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
    routeIntentId: Array.isArray(intent) ? intent[0] : intent,
    routeRequiredAmount,
    setFundAmount,
    setFundReturnTo,
    setShowFundPanel,
    setShowRedeemPanel,
    setShowSavingsProgressModal,
    walletReturnTo,
  });
  const resetFundPanel = () => {
    setShowFundPanel(false);
    setFundAmount('');
    setFundReturnTo(walletReturnTo);
  };
  const resetRedeemPanel = () => {
    setShowRedeemPanel(false);
    setRedeemPoints('');
  };
  const handleFundWallet = () =>
    fundWallet({
      activeMerchantId,
      activeMerchantSlug,
      customer,
      fundAmount,
      resetFundPanel,
      setIsFundPending,
      user,
      walletReturnTo: fundReturnTo,
    });
  const startSavingsWalletTopUp = () =>
    fundWallet({
      activeMerchantId,
      activeMerchantSlug,
      customer,
      fundAmount: savingsContributionAmount,
      resetFundPanel: () => setSavingsContributionAmount(''),
      setIsFundPending,
      user,
      walletReturnTo,
    });
  const handleRedeemPoints = () =>
    redeemWalletPoints({
      clearRedeemPoints: () => setRedeemPoints(''),
      closeRedeemPanel: () => setShowRedeemPanel(false),
      customerId: customer?.id,
      rawPoints: redeemPoints,
      redeemPoints: redeemMutation.mutateAsync,
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
  } = deriveWalletDisplayData(walletData, routeSavingsGoalId);
  const {
    handleAddSavingsContribution,
    handleFundSavingsWallet,
    handleOpenSavings,
  } = createWalletSavingsActions({
    activeMerchantId,
    activeMerchantSlug,
    goal: activeSavingsGoal,
    idempotencyKeyRef: savingsContributionIdempotencyKeyRef,
    refetchWallet: refetch,
    savingsContributionAmount,
    spendableBalance,
    startWalletTopUp: startSavingsWalletTopUp,
    setIsAddingSavingsContribution,
    setShowSavingsProgressModal,
    setSavingsContributionAmount,
  });
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
          canResolveCreditBaseline: isWalletFundingSessionReady,
          earningsAvailable,
          earningsBalance,
          fundAmount,
          fundReturnTo,
          fundingAccount,
          isAddingSavingsContribution,
          isCreatingFundingAccount: createFundingAccountMutation.isPending,
          isFundPending,
          isRedeemPending: redeemMutation.isPending,
          isRefetching,
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
