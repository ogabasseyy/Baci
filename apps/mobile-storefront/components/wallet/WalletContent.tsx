import { VTU_MIN_REDEEMABLE_POINTS } from '@baci/shared/lib';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, RefreshControl } from 'react-native';
import AppKeyboardAwareScrollView from '@/components/ui/AppKeyboardAwareScrollView';
import { DraggableModalSheet } from '@/components/ui/DraggableModalSheet';
import { useProductSearch } from '@/hooks/use-product-search';
import { useWalletCreditWatch } from '@/hooks/use-wallet-credit-watch';
import type { Product } from '@/types/product';
import { WalletActionsRow } from './WalletActionsRow';
import { WalletFundModal } from './WalletFundModal';
import { WalletHeroSection } from './WalletHeroSection';
import { WalletRedeemPanel } from './WalletRedeemPanel';
import { WalletSavingsCarousel } from './WalletSavingsCarousel';
import { WalletSavingsDeviceSwapModal } from './WalletSavingsDeviceSwapModal';
import { WalletSavingsProgressModal } from './WalletSavingsProgressModal';
import { WalletSavingsVariantResolutionModal } from './WalletSavingsVariantResolutionModal';
import { WalletTransactionHistory } from './WalletTransactionHistory';
import type { WalletContentProps } from './wallet-content.types';

export type { WalletContentProps } from './wallet-content.types';

export function WalletContent(props: WalletContentProps) {
  const {
    hasSavedCards = false,
    activeSavingsGoal,
    canCreateFundingAccount,
    canResolveCreditBaseline,
    colors,
    contentContainerStyle,
    createFundingAccountUnavailableMessage,
    customerId,
    earningsAvailable = false,
    earningsBalance,
    fundingAccount,
    fundReturnTo,
    isAddingSavingsContribution,
    isCreatingFundingAccount,
    isFundPending,
    isRedeemPending,
    isRefetching,
    loyaltyPoints,
    loyaltyTier,
    needsPhone,
    onCreateFundingAccount,
    onChangeRedeemPoints,
    onConfirmRedeem,
    onAddSavingsContribution,
    onChangeSavingsDevice,
    onChangeSavingsContributionAmount,
    onResolveSavingsVariant,
    onCloseSavingsProgress,
    onFundSavingsWallet,
    onManageCards,
    onOpenFundPanel,
    onOpenRedeemPanel,
    onQuickSave,
    onRefresh,
    onResetRedeem,
    onStartSavings,
    redeemPoints,
    savingsContributionAmount,
    savingsBalance,
    spendableBalance = 0,
    showSavingsProgress,
    showFundPanel,
    showRedeemPanel,
    totalBalance,
    transactions,
  } = props;
  const creditWatch = useWalletCreditWatch({
    canResolveBaseline: canResolveCreditBaseline,
    customerId,
    refetch: onRefresh,
    returnTo: fundReturnTo,
    transactions,
  });
  const [showSavingsDeviceSwap, setShowSavingsDeviceSwap] = useState(false);
  const [showSavingsVariantResolution, setShowSavingsVariantResolution] =
    useState(false);
  const [savingsDeviceSearch, setSavingsDeviceSearch] = useState('');
  const [isChangingSavingsDevice, setIsChangingSavingsDevice] = useState(false);
  const trimmedSavingsDeviceSearch = savingsDeviceSearch.trim();
  const {
    products: savingsDeviceProducts,
    isLoading: isSavingsDeviceLoading,
    resolveProduct,
  } = useProductSearch({
    enabled: showSavingsDeviceSwap,
    limit: 8,
    search: trimmedSavingsDeviceSearch || undefined,
  });
  const handleSelectSavingsDevice = async (
    product: Product,
    variantId?: string | null
  ) => {
    setIsChangingSavingsDevice(true);
    try {
      const didChange = await onChangeSavingsDevice(product, variantId);
      if (didChange) {
        setShowSavingsDeviceSwap(false);
        setSavingsDeviceSearch('');
      }
    } catch {
      Alert.alert('Unable to change device', 'Please try again in a moment.');
    }
    setIsChangingSavingsDevice(false);
  };

  return (
    <>
      <AppKeyboardAwareScrollView
        testID="wallet-scroll"
        contentContainerStyle={contentContainerStyle}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        <WalletHeroSection
          onOpenSavingsPlans={() => router.push('/wallet/savings')}
          activeSavingsGoal={activeSavingsGoal}
          isRefetching={isRefetching}
          refreshState={props.refreshState}
          onRefresh={onRefresh}
          canCreateFundingAccount={canCreateFundingAccount}
          createFundingAccountUnavailableMessage={
            createFundingAccountUnavailableMessage
          }
          earningsAvailable={earningsAvailable}
          earningsBalance={earningsBalance}
          fundingAccount={fundingAccount}
          creditWatch={showFundPanel ? undefined : creditWatch}
          isCreatingFundingAccount={isCreatingFundingAccount}
          needsPhone={needsPhone}
          onCreateFundingAccount={onCreateFundingAccount}
          loyaltyPoints={loyaltyPoints}
          loyaltyTier={loyaltyTier}
          onOpenFundPanel={onOpenFundPanel}
          onOpenRedeemPanel={onOpenRedeemPanel}
          savingsBalance={savingsBalance}
          totalBalance={totalBalance}
          utilityAccentColor={colors.primary}
          walletSetupState={
            props.primaryCapabilityPending
              ? 'checking'
              : props.primarySetup?.state
          }
          primaryCapabilityPending={props.primaryCapabilityPending}
        />
        <WalletSavingsCarousel
          colors={colors}
          goals={
            props.savingsGoals ?? (activeSavingsGoal ? [activeSavingsGoal] : [])
          }
          featuredGoalId={activeSavingsGoal?.id}
          onOpenFeatured={onStartSavings}
        />
        <WalletActionsRow
          hasSavedCards={hasSavedCards}
          colors={colors}
          hasActiveSavingsGoal={
            activeSavingsGoal !== null &&
            activeSavingsGoal.status !== 'completed'
          }
          needsVariantResolution={
            activeSavingsGoal?.status === 'completed' &&
            activeSavingsGoal.selection_unresolved
          }
          onManageCards={onManageCards}
          onQuickSave={onQuickSave}
          onStartSavings={onStartSavings}
          showPrimaryAction={!activeSavingsGoal}
          showQuickSave={false}
        />
        {showRedeemPanel ? (
          <WalletRedeemPanel
            colors={colors}
            isRedeemPending={isRedeemPending}
            loyaltyPoints={loyaltyPoints}
            minimumRedeemablePoints={VTU_MIN_REDEEMABLE_POINTS}
            onChangeRedeemPoints={onChangeRedeemPoints}
            onConfirmRedeem={onConfirmRedeem}
            onResetRedeem={onResetRedeem}
            redeemPoints={redeemPoints}
          />
        ) : null}
        <WalletTransactionHistory colors={colors} transactions={transactions} />
      </AppKeyboardAwareScrollView>
      <DraggableModalSheet
        fitContent={showFundPanel}
        visible={showSavingsProgress || showFundPanel}
        backgroundColor={colors.card}
        onClose={() => {
          if (showFundPanel) {
            props.primarySetup?.acknowledgeReady();
            props.onResetFund();
          } else onCloseSavingsProgress();
        }}
      >
        <WalletSavingsProgressModal
          embedded
          addAmount={savingsContributionAmount}
          colors={colors}
          goal={activeSavingsGoal}
          isAdding={isAddingSavingsContribution}
          hasPendingContribution={props.hasPendingSavingsContribution}
          isFundPending={isFundPending}
          onAddAmountChange={onChangeSavingsContributionAmount}
          onAddSavings={onAddSavingsContribution}
          onChangeDevice={() => setShowSavingsDeviceSwap(true)}
          onClose={onCloseSavingsProgress}
          onFundWallet={onFundSavingsWallet}
          onRefreshWallet={async () => onRefresh()}
          onResolveVariant={() => setShowSavingsVariantResolution(true)}
          visible={showSavingsProgress && !showFundPanel}
          walletBalance={spendableBalance}
          usesWalletBankTransfer={!!props.primarySetup}
        />
        <WalletFundModal {...props} embedded creditWatch={creditWatch} />
      </DraggableModalSheet>
      <WalletSavingsDeviceSwapModal
        colors={colors}
        currentAmount={activeSavingsGoal?.current_amount ?? 0}
        isLoading={isSavingsDeviceLoading}
        isPending={isChangingSavingsDevice}
        onClose={() => setShowSavingsDeviceSwap(false)}
        onSearchChange={setSavingsDeviceSearch}
        onSelectDevice={handleSelectSavingsDevice}
        resolveProduct={resolveProduct}
        products={savingsDeviceProducts}
        searchValue={savingsDeviceSearch}
        visible={showSavingsDeviceSwap}
      />
      <WalletSavingsVariantResolutionModal
        colors={colors}
        onClose={() => setShowSavingsVariantResolution(false)}
        onResolve={onResolveSavingsVariant}
        options={activeSavingsGoal?.variant_resolution_options ?? []}
        visible={
          showSavingsVariantResolution &&
          activeSavingsGoal?.status === 'completed' &&
          activeSavingsGoal.selection_unresolved === true
        }
      />
    </>
  );
}
