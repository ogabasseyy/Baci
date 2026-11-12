import Ionicons from '@react-native-vector-icons/ionicons';
import { Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useColorScheme } from '@/components/useColorScheme';
import type { WalletCreditWatch } from '@/hooks/use-wallet-credit-watch';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { SavingsProviderPreview } from './SavingsProviderPreview';
import { WalletCreditCheckPanel } from './WalletCreditCheckPanel';
import { WalletHeroCreateAccount } from './WalletHeroCreateAccount';
import { WalletHeroFundingAccount } from './WalletHeroFundingAccount';
import { WalletHeroLoyaltyPill } from './WalletHeroLoyaltyPill';
import { WalletHeroStartSavingsButton } from './WalletHeroStartSavingsButton';
import { WalletHeroStoreCredit } from './WalletHeroStoreCredit';
import { useWalletPrimaryReady } from './WalletPrimaryContext';
import { WalletQuickUtilities } from './WalletQuickUtilities';
import { styles } from './wallet.styles';
import type { WalletDisplayFundingAccount } from './wallet.types';

type WalletHeroSectionProps = {
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
  /** Set when there is no savings plan: shows Start Savings inside the card. */
  onStartSavings?: () => void;
  savingsBalance: number;
  /** PiggyVest only: the legacy balance purchases can spend. */
  storeCreditBalance?: number;
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
  onStartSavings,
  savingsBalance,
  storeCreditBalance,
  totalBalance,
}: WalletHeroSectionProps) {
  const visibleTier = formatTierLabel(loyaltyTier);
  // PiggyVest money funds savings goals only: never call it spendable.
  const primaryReady = useWalletPrimaryReady();
  const isDark = useColorScheme() === 'dark';
  return (
    <Animated.View
      entering={FadeIn.duration(400)}
      style={[styles.walletHero, isDark && styles.walletHeroDark]}
    >
      <View style={styles.walletHeroHeader}>
        <SavingsProviderPreview />
        <WalletHeroLoyaltyPill
          loyaltyPoints={loyaltyPoints}
          visibleTier={visibleTier}
          onOpenRedeemPanel={onOpenRedeemPanel}
        />
      </View>
      <View style={styles.balanceAndAccountRow}>
        <View style={styles.balanceBlock}>
          <Text style={styles.balanceLabel}>
            {primaryReady ? 'Savings wallet · NGN' : 'Total Balance · NGN'}
          </Text>
          <Text
            style={styles.balanceAmount}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.55}
          >
            {formatNgnCurrency(totalBalance)}
          </Text>
          {primaryReady ? (
            <WalletHeroStoreCredit balance={storeCreditBalance} />
          ) : null}
        </View>
        {fundingAccount ? (
          <WalletHeroFundingAccount account={fundingAccount} />
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
      {!fundingAccount && createFundingAccountUnavailableMessage ? (
        <Text style={styles.accountUnavailableMessage}>
          {createFundingAccountUnavailableMessage}
        </Text>
      ) : null}

      <View style={styles.balanceSummaryRow}>
        <View style={styles.balanceSummaryCell}>
          <View style={styles.loyaltyActionRow}>
            <Ionicons name="trending-up-outline" size={16} color="#50D6A3" />
            <Text style={styles.balanceSummaryLabel}>Earnings</Text>
          </View>
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
        <View style={styles.balanceSummaryDivider} />
        <View style={styles.balanceSummaryCell}>
          <View style={styles.loyaltyActionRow}>
            <Ionicons name="wallet-outline" size={16} color="#7CA7FF" />
            <Text style={styles.balanceSummaryLabel}>Savings</Text>
          </View>
          <Text
            style={styles.balanceSummaryValue}
            numberOfLines={1}
            adjustsFontSizeToFit={true}
            minimumFontScale={0.5}
          >
            {formatNgnCurrency(savingsBalance)}
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
      {onStartSavings ? (
        <WalletHeroStartSavingsButton onPress={onStartSavings} />
      ) : null}
    </Animated.View>
  );
}
