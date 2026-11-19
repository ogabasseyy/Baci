import Ionicons from '@react-native-vector-icons/ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { TYPOGRAPHY } from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { WALLET_COLORS } from './wallet.colors';

interface WalletHeroStoreCreditProps {
  /** Legacy wallet balance in naira: what purchases can spend. */
  balance: number | undefined;
}

/**
 * The customer's older wallet money, kept spendable on IMEI checks,
 * utilities and checkout. Hidden at zero so nobody sees an empty line.
 */
export function WalletHeroStoreCredit({ balance }: WalletHeroStoreCreditProps) {
  if (typeof balance !== 'number' || !(balance > 0)) {
    return null;
  }
  const amount = formatNgnCurrency(balance);
  return (
    <View
      accessible
      accessibilityLabel={`Store credit ${amount}. Use it on purchases.`}
      style={styles.row}
    >
      <Ionicons name="pricetag-outline" size={14} color="#F8B84C" />
      <Text style={styles.label} numberOfLines={1}>
        Store credit
      </Text>
      <Text style={styles.amount} numberOfLines={1}>
        {amount}
      </Text>
      <Text style={styles.hint} numberOfLines={1}>
        · use it on purchases
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  amount: {
    color: WALLET_COLORS.white,
    fontSize: 13,
    fontWeight: TYPOGRAPHY.weight.bold,
  },
  hint: {
    color: WALLET_COLORS.mutedText,
    flexShrink: 1,
    fontSize: 11,
  },
  label: {
    color: WALLET_COLORS.mutedText,
    fontSize: 12,
    fontWeight: TYPOGRAPHY.weight.medium,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 6,
    marginTop: 10,
  },
});
