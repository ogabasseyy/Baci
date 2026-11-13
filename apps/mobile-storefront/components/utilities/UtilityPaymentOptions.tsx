import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND, SPACING } from '@/constants/Colors';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { UtilityPiggyvestPayRow } from './UtilityPiggyvestPayRow';
import { UtilitySavingsMethod } from './UtilitySavingsMethod';
import { UtilityWalletTransferNudge } from './UtilityWalletTransferNudge';
import { getUtilityWalletCopy } from './utility-wallet-copy';
import { useVtuWalletPayStore } from './vtu-wallet-pay-store';

interface UtilityPaymentOptionsProps {
  amount: number;
  /** Signed-in customer of a merchant with wallet DVAs enabled. */
  canFundByBankTransfer?: boolean;
  /**
   * Prefilled utility deep-link the wallet returns the customer to after a
   * bank-transfer top-up; forwarded to the funding nudge. REQUIRED so a new
   * utility form cannot silently ship a nudge that strands the customer in the
   * wallet with no way back to the purchase they were funding.
   */
  returnToHref: WalletReturnHref;
  walletBalance?: number;
  walletError?: Error | null;
  walletIsLoading?: boolean;
  /** PiggyVest customer: the wallet balance is store credit. */
  walletIsStoreCredit?: boolean;
  /** PiggyVest check failed: the funding nudge waits for a retry. */
  walletPrimaryUnknown?: boolean;
  /**
   * False while the wallet query is disabled (owner resolving,
   * session hydration, account switch): TanStack reports
   * isLoading=false with no data in that state, which must render
   * as checking — never as a ₦0 balance (Codex R130 P2).
   */
  walletIsSettled?: boolean;
  /**
   * A store credit attempt for this exact purchase is retained (its answer
   * was lost): the next submit replays it on store credit, so the savings
   * wallet is never shown as the payment method meanwhile.
   */
  retainedStoreCredit?: boolean;
  /** An earlier PiggyVest attempt is kept: the submit replays it there. */
  retainedPiggyvest?: boolean;
}

/**
 * Wallet-only utility payment section. Utilities are always charged to
 * wallet balance — there is no card or gateway fallback. Shows the wallet
 * balance (or its loading/error state) plus the bank-transfer funding
 * nudge whenever the balance cannot cover the bill.
 */
export function UtilityPaymentOptions({
  amount,
  canFundByBankTransfer = false,
  returnToHref,
  walletBalance,
  walletError,
  walletIsLoading,
  walletIsSettled,
  walletIsStoreCredit = false,
  walletPrimaryUnknown,
  retainedStoreCredit = false,
  retainedPiggyvest = false,
}: UtilityPaymentOptionsProps) {
  const copy = getUtilityWalletCopy(walletIsStoreCredit);
  const payLabel = copy.pay;
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  // Unsettled (query disabled, no data yet) renders as checking even
  // though isLoading is false — the submit gate already treats it
  // that way (Codex R130 P2). A settled error is NOT checking: the
  // first fetch failed with no cached data, so surface the
  // wallet-unavailable state instead of an indefinite spinner
  // (Codex R143 P2).
  const isChecking =
    walletIsLoading === true || (walletIsSettled === false && !walletError);
  const balance = walletBalance ?? 0;
  const coversBill = amount > 0 && balance >= amount;
  const shortfall = amount > 0 ? Math.max(amount - balance, 0) : 0;
  // The PiggyVest savings wallet pays this (switched on, and it covers the
  // amount while store credit doesn't): it is the payment method shown, with
  // no store credit shortfall. Never for customers without one.
  const storedSavingsKobo = useVtuWalletPayStore((state) => state.balanceKobo);
  const savingsKobo = retainedStoreCredit ? null : storedSavingsKobo;
  const covered = useVtuWalletPayStore(
    (state) => amount > 0 && state.covers(amount)
  );
  // A kept PiggyVest attempt replays there, so it is the method shown.
  const savingsPays = covered || (amount > 0 && retainedPiggyvest);
  // A kept attempt resumes on the savings wallet even while paying from it
  // is switched off (no live balance then): shown as the method (Codex P2).
  if (
    savingsKobo === null &&
    !retainedStoreCredit &&
    amount > 0 &&
    retainedPiggyvest
  )
    return (
      <UtilitySavingsMethod colors={colors} balanceKobo={null} mode="resumes" />
    );
  // Before an amount is chosen (or when it pays) the savings wallet is the
  // only row: no store credit ₦0 for a PiggyVest customer.
  if (savingsKobo !== null && (savingsPays || amount <= 0))
    return (
      <UtilitySavingsMethod
        colors={colors}
        balanceKobo={savingsKobo}
        mode={savingsPays ? 'pays' : 'available'}
      />
    );
  // More than the savings wallet holds (and store credit is short too): say
  // its real balance and shortfall above the store credit options.
  const savingsShort =
    savingsKobo !== null &&
    balance < amount &&
    savingsKobo < Math.round(amount * 100);

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Payment Method
      </Text>

      {savingsShort ? (
        <UtilityPiggyvestPayRow
          balanceKobo={savingsKobo}
          colors={colors}
          mode="short"
          amount={amount}
        />
      ) : null}

      <UtilityWalletTransferNudge
        amount={amount}
        canFundByBankTransfer={canFundByBankTransfer}
        colors={colors}
        returnToHref={returnToHref}
        walletBalance={walletBalance}
        walletError={walletError}
        walletIsLoading={walletIsLoading}
        walletIsSettled={walletIsSettled}
        walletIsStoreCredit={walletIsStoreCredit}
        walletPrimaryUnknown={walletPrimaryUnknown}
      />

      {isChecking ? (
        <View
          style={[
            styles.walletRow,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          accessibilityRole="text"
          accessibilityLabel={copy.checkingLabel}
        >
          <ActivityIndicator color={BRAND.primary} />
          <View style={styles.walletCopy}>
            <Text style={[styles.walletTitle, { color: colors.text }]}>
              {copy.title}
            </Text>
            <Text style={[styles.walletMeta, { color: colors.textSecondary }]}>
              {copy.checking}
            </Text>
          </View>
        </View>
      ) : walletError ? (
        <View
          style={[
            styles.walletRow,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          accessibilityRole="text"
          accessibilityLabel={copy.unavailableLabel}
        >
          <View
            style={[
              styles.walletIcon,
              { backgroundColor: `${colors.textSecondary}10` },
            ]}
          >
            <Ionicons
              name="wallet-outline"
              size={18}
              color={colors.textSecondary}
            />
          </View>
          <View style={styles.walletCopy}>
            <Text style={[styles.walletTitle, { color: colors.text }]}>
              {copy.unavailable}
            </Text>
            <Text style={[styles.walletMeta, { color: colors.textSecondary }]}>
              {copy.unavailableBody}
            </Text>
          </View>
        </View>
      ) : (
        <View
          style={[
            styles.walletRow,
            {
              backgroundColor: coversBill ? `${BRAND.primary}12` : colors.card,
              borderColor: coversBill ? BRAND.primary : colors.border,
            },
          ]}
          accessibilityRole="text"
          accessibilityLabel={`${payLabel}. ₦${balance.toLocaleString()} available${coversBill ? '. Covers this purchase' : ''}`}
        >
          <View
            style={[
              styles.walletIcon,
              { backgroundColor: `${BRAND.primary}15` },
            ]}
          >
            <Ionicons name="wallet-outline" size={18} color={BRAND.primary} />
          </View>
          <View style={styles.walletCopy}>
            <Text style={[styles.walletTitle, { color: colors.text }]}>
              {payLabel}
            </Text>
            <Text style={[styles.walletMeta, { color: colors.textSecondary }]}>
              {coversBill
                ? `₦${balance.toLocaleString()} available · covers this purchase`
                : shortfall > 0
                  ? `₦${balance.toLocaleString()} available · ₦${shortfall.toLocaleString()} more needed`
                  : `₦${balance.toLocaleString()} available`}
            </Text>
          </View>
          <View
            style={[
              styles.walletRadioOuter,
              {
                borderColor: coversBill ? BRAND.primary : colors.border,
              },
            ]}
          >
            {coversBill ? <View style={styles.walletRadioInner} /> : null}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: SPACING.lg,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  walletCopy: {
    flex: 1,
    gap: 4,
  },
  walletIcon: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  walletMeta: {
    fontSize: 13,
  },
  walletRadioInner: {
    backgroundColor: BRAND.primary,
    borderRadius: 6,
    height: 12,
    width: 12,
  },
  walletRadioOuter: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  walletRow: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: SPACING.md,
  },
  walletTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
});
