import { VTU_MIN_REDEEMABLE_POINTS } from '@baci/shared/lib';
import { type ReactNode, useState } from 'react';
import { RefreshControl, type StyleProp, type ViewStyle } from 'react-native';
import AppKeyboardAwareScrollView from '@/components/ui/AppKeyboardAwareScrollView';
import type Colors from '@/constants/Colors';
import { useRefetchOnRefocus } from '@/hooks/use-refetch-on-refocus';
import { useUserPullRefresh } from '@/hooks/use-user-pull-refresh';
import { useWalletCreditWatch } from '@/hooks/use-wallet-credit-watch';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import type { Product } from '@/types/product';
import { isPrimaryWallet } from './is-primary-wallet';
import { PiggyvestSlowdownNotice } from './PiggyvestSlowdownNotice';
import { renderWalletSavingsSheetStep } from './render-wallet-savings-sheet-step';
import type { SavingsVariantResolveResult } from './resolve-completed-savings-goal-variant';
import { useSavingsDeviceSwap } from './use-savings-device-swap';
import { useWalletPrimaryUnknown } from './use-wallet-primary-unknown';
import { WalletActionsRow } from './WalletActionsRow';
import { WalletFundModal } from './WalletFundModal';
import type { WalletFundPhoneSubmitResult } from './WalletFundPhonePrompt';
import { WalletHeroSection } from './WalletHeroSection';
import { WalletInlineNotices } from './WalletInlineNotices';
import { WalletPrimaryContext } from './WalletPrimaryContext';
import { WalletRedeemPanel } from './WalletRedeemPanel';
import { WalletSavingsPlanCardWithSetup } from './WalletSavingsPlanCardWithSetup';
import { WalletSavingsProgressModal } from './WalletSavingsProgressModal';
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
  /** The PiggyVest read failed: balance and account can't be checked. */
  primaryUnreadable?: boolean;
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
  onResolveSavingsVariant: (
    variantId: string
  ) => Promise<SavingsVariantResolveResult>;
  onCloseSavingsProgress: () => void;
  onManageCards: () => void;
  onFundSavingsWallet: () => void;
  onOpenFundPanel: () => void;
  onOpenRedeemPanel: () => void;
  onQuickSave: () => void;
  onRefresh: () => void;
  onResetFund: () => void;
  /** The PIN prompt: inside the open savings sheet (iOS can't stack modals). */
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
