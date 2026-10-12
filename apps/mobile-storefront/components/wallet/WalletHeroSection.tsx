import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { BRAND } from '@/constants/Colors';
import type { WalletCreditWatch } from '@/hooks/use-wallet-credit-watch';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { isHostedStagingTestPaymentsEnabled } from '@/lib/is-hosted-staging-wallet-top-up-blocked';
import { SavingsProviderPreview } from './SavingsProviderPreview';
import { WalletCreditCheckPanel } from './WalletCreditCheckPanel';
import { WalletHeroCreateAccount } from './WalletHeroCreateAccount';
import { WalletHeroFundingAccount } from './WalletHeroFundingAccount';
import { WalletHeroSavingsAccount } from './WalletHeroSavingsAccount';
import { WalletQuickUtilities } from './WalletQuickUtilities';
import { WALLET_COLORS } from './wallet.colors';
import { styles } from './wallet.styles';
import type { WalletDisplayFundingAccount } from './wallet.types';

type WalletHeroSectionProps = {
  activeSavingsGoal?: Pick<
    WalletActiveSavingsGoal,
    'id' | 'status' | 'source_mode'
  > | null;
  isRefetching?: boolean;
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
};

function formatTierLabel(tier: string | null | undefined) {
  const normalizedTier = tier?.trim() || '';
  if (!normalizedTier || normalizedTier.toLowerCase() === 'bronze') {
    return null;
  }
  return `${normalizedTier.charAt(0).toUpperCase()}${normalizedTier.slice(1)}`;
}

export function WalletHeroSection({
  activeSavingsGoal,
  isRefetching = false,
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
}: WalletHeroSectionProps) {
  const visibleTier = formatTierLabel(loyaltyTier);
  const savingsGoalId =
    !fundingAccount &&
    isHostedStagingTestPaymentsEnabled() &&
    activeSavingsGoal?.status === 'active' &&
    activeSavingsGoal.source_mode === 'manual'
      ? activeSavingsGoal.id
      : null;
  return (
    <Animated.View entering={FadeIn.duration(400)} style={styles.walletHero}>
      <View style={styles.walletHeroHeader}>
        <SavingsProviderPreview />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add money"
          accessibilityHint="Opens wallet funding options"
          hitSlop={6}
          // Keep the funding action as the single bright accent in the hero.
          style={[
            styles.addMoneyButton,
            { borderColor: BRAND.primary, borderWidth: 2 },
          ]}
          onPress={onOpenFundPanel}
        >
          <Ionicons
            accessible={false}
            importantForAccessibility="no"
            name="add-circle-outline"
            size={14}
            color={WALLET_COLORS.white}
          />
          <Text style={styles.addMoneyButtonText}>Add Money</Text>
        </Pressable>
      </View>
      <View style={styles.balanceAndAccountRow}>
        <View style={styles.balanceBlock}>
          <Text style={styles.balanceLabel}>Total Balance · NGN</Text>
          <Text
            style={styles.balanceAmount}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.55}
          >
            {formatNgnCurrency(totalBalance)}
          </Text>
        </View>
        {fundingAccount ? (
          <WalletHeroFundingAccount account={fundingAccount} />
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
      {!fundingAccount &&
      !savingsGoalId &&
      createFundingAccountUnavailableMessage ? (
        <Text style={styles.accountUnavailableMessage}>
          {createFundingAccountUnavailableMessage}
        </Text>
      ) : null}

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
        <View style={styles.balanceSummaryCell}>
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
        </View>
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
    </Animated.View>
  );
}
