import { VTU_MIN_REDEEMABLE_POINTS } from '@baci/shared/lib';
import { useState } from 'react';
import { RefreshControl } from 'react-native';
import AppKeyboardAwareScrollView from '@/components/ui/AppKeyboardAwareScrollView';
import { useRefetchOnRefocus } from '@/hooks/use-refetch-on-refocus';
import { useUserPullRefresh } from '@/hooks/use-user-pull-refresh';
import { useWalletCreditWatch } from '@/hooks/use-wallet-credit-watch';
import { isPrimaryWallet } from './is-primary-wallet';
import { PiggyvestSlowdownNotice } from './PiggyvestSlowdownNotice';
import { renderWalletSavingsSheetStep } from './render-wallet-savings-sheet-step';
import { useSavingsDeviceSwap } from './use-savings-device-swap';
import { useWalletPrimaryUnknown } from './use-wallet-primary-unknown';
import { WalletActionsRow } from './WalletActionsRow';
import { WalletFundModal } from './WalletFundModal';
import { WalletHeroSection } from './WalletHeroSection';
import { WalletInlineNotices } from './WalletInlineNotices';
import { WalletPrimaryContext } from './WalletPrimaryContext';
import { WalletRedeemPanel } from './WalletRedeemPanel';
import { WalletSavingsPlanCardWithSetup } from './WalletSavingsPlanCardWithSetup';
import { WalletSavingsProgressModal } from './WalletSavingsProgressModal';
import { WalletTransactionHistory } from './WalletTransactionHistory';
import type { WalletContentProps } from './wallet-content-props.types';

export type { WalletContentProps } from './wallet-content-props.types';

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
    walletBalance = 0,
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
  const [showSavingsVariantResolution, setShowSavingsVariantResolution] =
    useState(false);
  const swap = useSavingsDeviceSwap(
    onChangeSavingsDevice,
    activeSavingsGoal?.id
  );
  const pullRefresh = useUserPullRefresh(onRefresh);
  useRefetchOnRefocus(onRefresh); // re-entry re-reads the wallet once
  const primaryUnknown = useWalletPrimaryUnknown(
    props.merchantId,
    props.primaryUnreadable
  );
  const savingsSheetOpen = showSavingsProgress && Boolean(activeSavingsGoal);
  return (
    <WalletPrimaryContext.Provider value={isPrimaryWallet(props)}>
      <AppKeyboardAwareScrollView
        testID="wallet-scroll"
        contentContainerStyle={contentContainerStyle}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl {...pullRefresh} tintColor={colors.primary} />
        }
      >
        <PiggyvestSlowdownNotice inset hidden={savingsSheetOpen} />
        <WalletHeroSection
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
          onStartSavings={activeSavingsGoal ? undefined : onStartSavings}
          primaryBalanceReady={props.primaryReady === true}
          primaryStale={props.primaryStale === true}
          primaryUnknown={primaryUnknown}
          savingsBalance={savingsBalance}
          savingsWalletBalance={walletBalance}
          storeCreditBalance={props.storeCreditBalance}
          totalBalance={totalBalance}
          utilityAccentColor={colors.primary}
        />
        <WalletInlineNotices
          colors={colors}
          fundSheetOpen={props.showFundPanel}
          goalId={activeSavingsGoal?.id}
          savingsSheetOpen={savingsSheetOpen}
        />
        {activeSavingsGoal ? (
          <WalletSavingsPlanCardWithSetup
            colors={colors}
            awaitingSettlement={props.goalAwaitingSettlement}
            goal={activeSavingsGoal}
            onOpen={onStartSavings}
            pausePolling={savingsSheetOpen}
          />
        ) : null}
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
          // Start Savings now lives inside the wallet card.
          showPrimaryAction={false}
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
        <WalletTransactionHistory {...props} />
      </AppKeyboardAwareScrollView>
      <WalletSavingsProgressModal
        addAmount={savingsContributionAmount}
        colors={colors}
        goal={activeSavingsGoal}
        isAdding={isAddingSavingsContribution}
        hasPendingContribution={props.hasPendingSavingsContribution}
        walletUpdatedAt={props.walletUpdatedAt}
        isFundPending={isFundPending}
        onAddAmountChange={onChangeSavingsContributionAmount}
        onAddSavings={onAddSavingsContribution}
        onChangeDevice={() => swap.setShowSavingsDeviceSwap(true)}
        onClose={() => {
          swap.setShowSavingsDeviceSwap(false);
          setShowSavingsVariantResolution(false);
          onCloseSavingsProgress();
        }}
        onFundWallet={onFundSavingsWallet}
        onRefreshWallet={async () => onRefresh()}
        onResolveVariant={() => setShowSavingsVariantResolution(true)}
        overlay={savingsSheetOpen ? props.pinPrompt : null}
        phoneSwapStep={renderWalletSavingsSheetStep({
          colors,
          goal: activeSavingsGoal,
          showVariantPick: showSavingsVariantResolution,
          onCloseVariantPick: () => setShowSavingsVariantResolution(false),
          onResolveVariant: onResolveSavingsVariant,
          swap,
        })}
        visible={showSavingsProgress}
        walletBalance={walletBalance}
      />
      <WalletFundModal {...props} creditWatch={creditWatch} />
      {savingsSheetOpen ? null : props.pinPrompt}
    </WalletPrimaryContext.Provider>
  );
}
