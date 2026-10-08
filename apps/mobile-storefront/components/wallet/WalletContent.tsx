import { VTU_MIN_REDEEMABLE_POINTS } from '@baci/shared/lib';
import { useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Alert, RefreshControl } from 'react-native';
import AppKeyboardAwareScrollView from '@/components/ui/AppKeyboardAwareScrollView';
import type Colors from '@/constants/Colors';
import { useProductSearch } from '@/hooks/use-product-search';
import { useWalletCreditWatch } from '@/hooks/use-wallet-credit-watch';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import type { Product } from '@/types/product';
import { WalletActionsRow } from './WalletActionsRow';
import { WalletFundModal } from './WalletFundModal';
import type { WalletFundPhoneSubmitResult } from './WalletFundPhonePrompt';
import { WalletHeroSection } from './WalletHeroSection';
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
  isCreatingFundingAccount: boolean;
  isFundPending: boolean;
  isRedeemPending: boolean;
  isRefetching: boolean;
  loyaltyPoints: number;
  loyaltyTier?: string | null;
  needsPhone: boolean;
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
  onResetRedeem: () => void;
  onStartSavings: () => void;
  onSubmitPhone: (phone: string) => Promise<WalletFundPhoneSubmitResult>;
  redeemPoints: string;
  savingsContributionAmount: string;
  savingsBalance: number;
  spendableBalance?: number;
  showSavingsProgress: boolean;
  showQuickSave: boolean;
  showFundPanel: boolean;
  showRedeemPanel: boolean;
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
          activeSavingsGoal={activeSavingsGoal}
          isRefetching={isRefetching}
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
        />
        {activeSavingsGoal ? (
          <WalletSavingsPlanCard
            colors={colors}
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
      <WalletSavingsProgressModal
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
        visible={showSavingsProgress}
        walletBalance={spendableBalance}
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
    </>
  );
}
