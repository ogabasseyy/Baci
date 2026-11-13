import { VTU_MIN_REDEEMABLE_POINTS } from '@baci/shared/lib';
import { type ReactNode, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { RefreshControl } from 'react-native';
import AppKeyboardAwareScrollView from '@/components/ui/AppKeyboardAwareScrollView';
import type Colors from '@/constants/Colors';
import { useUserPullRefresh } from '@/hooks/use-user-pull-refresh';
import { useWalletCreditWatch } from '@/hooks/use-wallet-credit-watch';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import type { Product } from '@/types/product';
import { isPrimaryWallet } from './is-primary-wallet';
import { useSavingsDeviceSwap } from './use-savings-device-swap';
import { WalletActionsRow } from './WalletActionsRow';
import { WalletFundModal } from './WalletFundModal';
import type { WalletFundPhoneSubmitResult } from './WalletFundPhonePrompt';
import { WalletHeroSection } from './WalletHeroSection';
import { WalletPrimaryContext } from './WalletPrimaryContext';
import { WalletRedeemPanel } from './WalletRedeemPanel';
import { WalletSavingsDeviceSwapModal } from './WalletSavingsDeviceSwapModal';
import { WalletSavingsPlanCard } from './WalletSavingsPlanCard';
import { WalletSavingsProgressModal } from './WalletSavingsProgressModal';
import { WalletSavingsVariantResolutionModal } from './WalletSavingsVariantResolutionModal';
import {
  type WalletTransaction,
  WalletTransactionHistory,
} from './WalletTransactionHistory';
import type { WalletDisplayFundingAccount } from './wallet.types';

type WalletColors = (typeof Colors)['light'];

export interface WalletContentProps {
  merchantId?: string;
  hasSavedCards?: boolean;
  activeSavingsGoal: WalletActiveSavingsGoal | null;
  canCreateFundingAccount: boolean;
  /** False while the route's persisted funding session is still being written. */
  canResolveCreditBaseline?: boolean;
  colors: WalletColors;
  contentContainerStyle: StyleProp<ViewStyle>;
  createFundingAccountUnavailableMessage?: string;
  /** Scopes the persisted bank-transfer funding session the credit watch reads. */
  customerId?: string;
  earningsAvailable?: boolean;
  earningsBalance: number | null;
  fundAmount: string;
  fundingAccount: WalletDisplayFundingAccount | null;
  /** Sanitized deep-link for the post-credit "Return to your purchase" CTA. */
  fundReturnTo?: WalletReturnHref;
  isAddingSavingsContribution: boolean;
  hasPendingSavingsContribution?: boolean;
  goalAwaitingSettlement?: boolean;
  /** The wallet query's last-updated time: re-reads the goal readiness gate. */
  walletUpdatedAt?: number;
  isCreatingFundingAccount: boolean;
  isFundPending: boolean;
  isRedeemPending: boolean;
  isRefetching: boolean;
  loyaltyPoints: number;
  loyaltyTier?: string | null;
  needsPhone: boolean;
  primaryReady?: boolean;
  walletPrimaryUnsettled?: boolean;
  savingsPrimary?: boolean;
  onCreateFundingAccount: () => void;
  onChangeFundAmount: (value: string) => void;
  onChangeRedeemPoints: (value: string) => void;
  onConfirmFund: () => void;
  onConfirmRedeem: () => void;
  onAddSavingsContribution: () => void;
  onChangeSavingsDevice: (
    product: Product,
    variantId?: string | null
  ) => Promise<boolean>;
  onChangeSavingsContributionAmount: (value: string) => void;
  onResolveSavingsVariant: (variantId: string) => Promise<boolean>;
  onCloseSavingsProgress: () => void;
  onManageCards: () => void;
  onFundSavingsWallet: () => void;
  onOpenFundPanel: () => void;
  onOpenRedeemPanel: () => void;
  onQuickSave: () => void;
  onRefresh: () => void;
  onResetFund: () => void;
  /**
   * The wallet PIN prompt. It is mounted inside the savings sheet while that
   * sheet is open (iOS cannot stack sibling modals), and at the root otherwise.
   */
  pinPrompt?: ReactNode;
  onResetRedeem: () => void;
  onStartSavings: () => void;
  onSubmitPhone: (phone: string) => Promise<WalletFundPhoneSubmitResult>;
  redeemPoints: string;
  savingsContributionAmount: string;
  savingsBalance: number;
  walletBalance?: number;
  showSavingsProgress: boolean;
  showQuickSave: boolean;
  showFundPanel: boolean;
  showRedeemPanel: boolean;
  /** PiggyVest only: the legacy balance, spendable on purchases. */
  storeCreditBalance?: number;
  totalBalance: number;
  /** Wallet ledger; the credit watch reads bank-transfer top-ups off it. */
  transactions: WalletTransaction[];
}

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
  const {
    isChangingSavingsDevice,
    isSavingsDeviceLoading,
    resolveProduct,
    savingsDeviceProducts,
    savingsDeviceSearch,
    setSavingsDeviceSearch,
    setShowSavingsDeviceSwap,
    showSavingsDeviceSwap,
    handleSelectSavingsDevice,
  } = useSavingsDeviceSwap(onChangeSavingsDevice);
  const pullRefresh = useUserPullRefresh(onRefresh);
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
          savingsBalance={savingsBalance}
          savingsWalletBalance={walletBalance}
          storeCreditBalance={props.storeCreditBalance}
          totalBalance={totalBalance}
          utilityAccentColor={colors.primary}
        />
        {activeSavingsGoal ? (
          <WalletSavingsPlanCard
            colors={colors}
            awaitingSettlement={props.goalAwaitingSettlement}
            goal={activeSavingsGoal}
            onOpen={onStartSavings}
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
        <WalletTransactionHistory colors={colors} transactions={transactions} />
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
        onChangeDevice={() => setShowSavingsDeviceSwap(true)}
        onClose={onCloseSavingsProgress}
        onFundWallet={onFundSavingsWallet}
        onRefreshWallet={async () => onRefresh()}
        onResolveVariant={() => setShowSavingsVariantResolution(true)}
        overlay={savingsSheetOpen ? props.pinPrompt : null}
        visible={showSavingsProgress}
        walletBalance={walletBalance}
      />
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
      <WalletFundModal {...props} creditWatch={creditWatch} />
      {savingsSheetOpen ? null : props.pinPrompt}
    </WalletPrimaryContext.Provider>
  );
}
