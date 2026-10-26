import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import type { usePiggyvestWalletSetup } from '@/hooks/use-piggyvest-wallet-setup';
import type { WalletCreditWatch } from '@/hooks/use-wallet-credit-watch';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { isHostedStagingTestPaymentsEnabled } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { SavingsProviderPreview } from './SavingsProviderPreview';
import { WalletCreditCheckPanel } from './WalletCreditCheckPanel';
import { WalletHeroAction } from './WalletHeroAction';
import { WalletHeroCreateAccount } from './WalletHeroCreateAccount';
import { WalletHeroFundingAccount } from './WalletHeroFundingAccount';
import { WalletHeroSavingsAccount } from './WalletHeroSavingsAccount';
import { WalletQuickUtilities } from './WalletQuickUtilities';
import {
  WalletRefreshNotice,
  type WalletRefreshState,
} from './WalletRefreshNotice';
import { styles } from './wallet.styles';
import type { WalletDisplayFundingAccount } from './wallet.types';

type WalletHeroSectionProps = {
  onOpenSavingsPlans?: () => void;
  activeSavingsGoal?: Pick<
    WalletActiveSavingsGoal,
    'id' | 'status' | 'source_mode'
  > | null;
  isRefetching?: boolean;
  refreshState?: WalletRefreshState;
  onRefresh?: () => void;
  canCreateFundingAccount?: boolean;
  createFundingAccountUnavailableMessage?: string;
  isCreatingFundingAccount?: boolean;
  needsPhone?: boolean;
  onCreateFundingAccount?: () => void;
  utilityAccentColor?: string;
  earningsAvailable?: boolean;
  earningsBalance: number | null;
  fundingAccount?: WalletDisplayFundingAccount | null;
  creditWatch?: WalletCreditWatch;
  loyaltyPoints: number;
  loyaltyTier?: string | null;
  onOpenFundPanel: () => void;
  onOpenRedeemPanel: () => void;
  savingsBalance: number;
  totalBalance: number;
  walletSetupState?: ReturnType<typeof usePiggyvestWalletSetup>['state'];
  primaryCapabilityPending?: boolean;
};

function formatTierLabel(tier: string | null | undefined) {
  const normalizedTier = tier?.trim() || '';
  if (!normalizedTier || normalizedTier.toLowerCase() === 'bronze') {
    return null;
  }
  return `${normalizedTier.charAt(0).toUpperCase()}${normalizedTier.slice(1)}`;
}

export function WalletHeroSection({
  onOpenSavingsPlans,
  activeSavingsGoal,
  isRefetching = false,
  refreshState,
  onRefresh,
  canCreateFundingAccount = false,
  createFundingAccountUnavailableMessage,
  isCreatingFundingAccount = false,
  needsPhone = false,
  onCreateFundingAccount = () => undefined,
  utilityAccentColor = '#F8B84C',
  earningsAvailable = false,
  earningsBalance,
  fundingAccount,
  creditWatch,
  loyaltyPoints,
  loyaltyTier,
  onOpenFundPanel,
  onOpenRedeemPanel,
  savingsBalance,
  totalBalance,
  walletSetupState,
  primaryCapabilityPending = false,
}: WalletHeroSectionProps) {
  const visibleTier = formatTierLabel(loyaltyTier);
  const hasHeaderAction = !!fundingAccount || !!walletSetupState;
  const savingsGoalId =
    !fundingAccount &&
    isHostedStagingTestPaymentsEnabled() &&
    activeSavingsGoal?.status === 'active' &&
    activeSavingsGoal.source_mode === 'manual'
      ? activeSavingsGoal.id
      : null;
  return (
    <View style={styles.walletHero}>
      <View style={styles.walletHeroUpperArea}>
        <View
          testID="wallet-balance-header"
          style={[
            styles.walletHeroHeader,
            !hasHeaderAction && styles.walletHeroHeaderWithoutAccount,
          ]}
        >
          {!hasHeaderAction ? (
            <Text style={styles.balanceLabel}>Total Balance · NGN</Text>
          ) : null}
          <View style={!hasHeaderAction && styles.balanceProviderAlignment}>
            <SavingsProviderPreview />
          </View>
          {fundingAccount ? (
            <WalletHeroAction hasAccount onPress={onOpenFundPanel} />
          ) : null}
        </View>
        <View
          style={[
            styles.balanceAndAccountRow,
            !hasHeaderAction && styles.balanceAndAccountRowWithoutAccount,
          ]}
        >
          <View style={styles.balanceBlock}>
            {hasHeaderAction ? (
              <Text style={styles.balanceLabel}>Total Balance · NGN</Text>
            ) : null}
            <Text
              style={[
                styles.balanceAmount,
                !hasHeaderAction && styles.balanceAmountWithoutAccount,
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.55}
            >
              {formatNgnCurrency(totalBalance)}
            </Text>
          </View>
          {fundingAccount ? (
            <WalletHeroFundingAccount account={fundingAccount} />
          ) : walletSetupState ? (
            <View style={styles.balanceBlock} />
          ) : savingsGoalId ? (
            <WalletHeroSavingsAccount
              goalId={savingsGoalId}
              isRefetching={isRefetching}
            />
          ) : (
            <WalletHeroCreateAccount
              canCreate={canCreateFundingAccount}
              isCreating={isCreatingFundingAccount}
              needsPhone={needsPhone}
              onCreate={onCreateFundingAccount}
              onOpenFundPanel={onOpenFundPanel}
            />
          )}
        </View>
        {!fundingAccount && walletSetupState ? (
          <View
            testID="wallet-setup-account-space"
            style={styles.accountSetupSpace}
          >
            <WalletHeroAction
              hasAccount={false}
              setupState={walletSetupState}
              disabled={primaryCapabilityPending}
              onPress={onOpenFundPanel}
            />
          </View>
        ) : null}
      </View>
      {!fundingAccount &&
      !walletSetupState &&
      !savingsGoalId &&
      createFundingAccountUnavailableMessage ? (
        <Text style={styles.accountUnavailableMessage}>
          {createFundingAccountUnavailableMessage}
        </Text>
      ) : null}

      <WalletRefreshNotice
        state={refreshState ?? (isRefetching ? 'updating' : undefined)}
        onRetry={onRefresh}
      />
      <View style={styles.balanceSummaryRow}>
        <View style={styles.balanceSummaryCell}>
          <Ionicons name="trending-up-outline" size={18} color="#50D6A3" />
          <Text style={styles.balanceSummaryLabel}>Earnings</Text>
          <Text
            style={styles.balanceSummaryValue}
            numberOfLines={1}
            adjustsFontSizeToFit={true}
            minimumFontScale={0.5}
          >
            {earningsAvailable && earningsBalance !== null
              ? formatNgnCurrency(earningsBalance)
              : '—'}
          </Text>
        </View>
        <Pressable
          style={styles.balanceSummaryCell}
          accessibilityRole="button"
          accessibilityLabel="View all savings plans"
          onPress={onOpenSavingsPlans}
          disabled={!onOpenSavingsPlans}
        >
          <Ionicons name="wallet-outline" size={18} color="#7CA7FF" />
          <Text style={styles.balanceSummaryLabel}>Savings</Text>
          <Text
            style={styles.balanceSummaryValue}
            numberOfLines={1}
            adjustsFontSizeToFit={true}
            minimumFontScale={0.5}
          >
            {formatNgnCurrency(savingsBalance)}
          </Text>
        </Pressable>
        <View style={styles.balanceSummaryCell}>
          <View style={styles.loyaltyActionRow}>
            <Ionicons name="star-outline" size={18} color="#F8B84C" />
            {loyaltyPoints > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Redeem loyalty points"
                accessibilityHint="Opens the loyalty redemption panel"
                onPress={onOpenRedeemPanel}
                style={styles.redeemPill}
              >
                <Text style={styles.redeemPillText}>Redeem</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.balanceSummaryLabel}>
            {visibleTier ? `Loyalty · ${visibleTier}` : 'Loyalty'}
          </Text>
          <Text
            style={styles.balanceSummaryValue}
            numberOfLines={1}
            adjustsFontSizeToFit={true}
            minimumFontScale={0.5}
          >
            {loyaltyPoints.toLocaleString()} pts
          </Text>
        </View>
      </View>
      <WalletQuickUtilities accentColor={utilityAccentColor} />
      {fundingAccount && creditWatch ? (
        <WalletCreditCheckPanel
          accentColor="#F8B84C"
          textColor="#FFFFFF"
          watch={creditWatch}
        />
      ) : null}
    </View>
  );
}
