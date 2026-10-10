import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND, SPACING } from '@/constants/Colors';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { UtilityWalletTransferNudge } from './UtilityWalletTransferNudge';

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
}: UtilityPaymentOptionsProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const balance = walletBalance ?? 0;
  const coversBill = amount > 0 && balance >= amount;
  const shortfall = amount > 0 ? Math.max(amount - balance, 0) : 0;

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Payment Method
      </Text>

      <UtilityWalletTransferNudge
        amount={amount}
        canFundByBankTransfer={canFundByBankTransfer}
        colors={colors}
        returnToHref={returnToHref}
        walletBalance={walletBalance}
        walletError={walletError}
        walletIsLoading={walletIsLoading}
      />

      {walletIsLoading === true ? (
        <View
          style={[
            styles.walletRow,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          accessibilityRole="text"
          accessibilityLabel="Wallet. Checking wallet balance"
        >
          <ActivityIndicator color={BRAND.primary} />
          <View style={styles.walletCopy}>
            <Text style={[styles.walletTitle, { color: colors.text }]}>
              Wallet
            </Text>
            <Text style={[styles.walletMeta, { color: colors.textSecondary }]}>
              Checking wallet balance…
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
          accessibilityLabel="Wallet unavailable. Could not load your wallet balance"
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
              Wallet unavailable
            </Text>
            <Text style={[styles.walletMeta, { color: colors.textSecondary }]}>
              Could not load your wallet balance. Please try again.
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
          accessibilityRole="radio"
          accessibilityState={{ checked: coversBill }}
          accessibilityLabel={`Pay with wallet. ₦${balance.toLocaleString()} available${coversBill ? '. Covers this purchase' : ''}`}
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
              Pay with wallet
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
