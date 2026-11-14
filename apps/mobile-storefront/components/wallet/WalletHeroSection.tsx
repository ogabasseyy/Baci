import Ionicons from '@react-native-vector-icons/ionicons';
import { Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useColorScheme } from '@/components/useColorScheme';
import { useLegacyFundingUnconfirmed } from '@/hooks/use-legacy-funding-unconfirmed';
import type { WalletCreditWatch } from '@/hooks/use-wallet-credit-watch';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { hasSpendableBalance } from '@/lib/has-spendable-balance';
import { SAVINGS_WALLET_CAN_PAY_UTILITIES } from '@/lib/savings-wallet-can-pay-utilities';
import { SavingsProviderPreview } from './SavingsProviderPreview';
import { WalletCreditCheckPanel } from './WalletCreditCheckPanel';
import { WalletHeroAddMoneyButton } from './WalletHeroAddMoneyButton';
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
  /** PiggyVest only: the PiggyVest main wallet balance (naira). */
  savingsWalletBalance?: number;
  /** PiggyVest balance ready (vs pending); defaults to the context. */
  primaryBalanceReady?: boolean;
  /** PiggyVest merchant whose PiggyVest read failed: nothing to show yet. */
  primaryUnknown?: boolean;
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
  primaryBalanceReady,
  primaryUnknown,
  savingsBalance,
  savingsWalletBalance,
  storeCreditBalance,
  totalBalance,
}: WalletHeroSectionProps) {
  const visibleTier = formatTierLabel(loyaltyTier);
  // PiggyVest money (main wallet plus goals) funds savings only: never call
  // it spendable.
  const primaryReady = useWalletPrimaryReady();
  // The context says "savings wallet" also while the PiggyVest balance is
  // pending; readiness of the balance itself is separate (Codex), so an
  // unknown balance shows "—", never an authoritative ₦0.
  const balanceReady = primaryBalanceReady ?? primaryReady;
  // A PiggyVest account whose balance isn't ready yet is still a savings
  // wallet (Codex): its older balance is store credit, not the total.
  const pendingPiggyvest =
    (primaryReady && !balanceReady) ||
    (!primaryReady && fundingAccount?.provider === 'piggyvest');
  // The PiggyVest read failed (Fable walk 10): never present the goals
  // total as the balance; the older balance is still store credit.
  const balanceUnknown = pendingPiggyvest || primaryUnknown === true;
  const savingsView = primaryReady || balanceUnknown;
  const storeCredit = primaryUnknown
    ? (storeCreditBalance ?? savingsWalletBalance)
    : storeCreditBalance;
  // A legacy account number from a wallet cached before the merchant's
  // PiggyVest status is known stays hidden until it is (Codex).
  const legacyUnconfirmed = useLegacyFundingUnconfirmed(
    fundingAccount?.provider
  );
  // Utility shortcuts appear only when there is money to pay with; legacy
  // wallets always show them, as before.
  // An unread store credit balance isn't "nothing to pay with" (Muse): the
  // shortcuts stay, and each purchase screen handles a shortfall itself.
  const showUtilities =
    !savingsView ||
    storeCredit === undefined ||
    hasSpendableBalance({
      savingsWalletBalance: balanceUnknown ? 0 : savingsWalletBalance,
      storeCreditBalance: storeCredit,
      // Utilities' own switch, not IMEI's (Codex): the shortcuts open them.
      savingsWalletCanPay: SAVINGS_WALLET_CAN_PAY_UTILITIES,
    });
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
            {savingsView ? 'Savings wallet · NGN' : 'Total Balance · NGN'}
          </Text>
          <Text
            style={styles.balanceAmount}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.55}
          >
            {balanceUnknown
              ? '—'
              : formatNgnCurrency(
                  // One name for the PiggyVest main wallet: the hero shows
                  // the savings wallet alone; goals are the "In goals" tile.
                  primaryReady ? (savingsWalletBalance ?? 0) : totalBalance
                )}
          </Text>
          {savingsView ? <WalletHeroStoreCredit balance={storeCredit} /> : null}
          {primaryUnknown ? (
            <Text style={styles.accountUnavailableMessage}>
              Can’t check your savings balance right now.
            </Text>
          ) : null}
        </View>
        {!fundingAccount && primaryUnknown ? (
          // The account state is unknown: never offer to create one.
          <Text style={styles.accountUnavailableMessage}>
            Can’t check your account right now.
          </Text>
        ) : primaryUnknown && fundingAccount?.provider === 'piggyvest' ? (
          // The server can't be reached: the last-known PiggyVest account
          // number is shown, marked as possibly out of date (walk 12).
          <View>
            <WalletHeroFundingAccount
              account={fundingAccount}
              emphasizeCopied
              purpose="savings"
            />
            <Text style={styles.accountUnavailableMessage}>
              Last known account. It may be out of date.
            </Text>
          </View>
        ) : fundingAccount && legacyUnconfirmed ? (
          <Text style={styles.accountUnavailableMessage}>
            Checking your account…
          </Text>
        ) : fundingAccount ? (
          <WalletHeroFundingAccount
            account={fundingAccount}
            emphasizeCopied={savingsView}
            purpose={savingsView ? 'savings' : 'wallet'}
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
      {savingsView && fundingAccount ? (
        <WalletHeroAddMoneyButton onPress={onOpenFundPanel} />
      ) : null}
      {!fundingAccount &&
      !primaryUnknown &&
      createFundingAccountUnavailableMessage ? (
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
            <Text style={styles.balanceSummaryLabel}>
              {savingsView ? 'In goals' : 'Savings'}
            </Text>
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
      {showUtilities ? (
        <WalletQuickUtilities accentColor={utilityAccentColor} />
      ) : null}
      {/* The checker reads the store-credit ledger, where PiggyVest
          transfers never appear: hidden on the PiggyVest path (Codex). */}
      {fundingAccount &&
      creditWatch &&
      !primaryReady &&
      fundingAccount.provider !== 'piggyvest' ? (
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
