import Ionicons from '@react-native-vector-icons/ionicons';
import { Text, View } from 'react-native';
import { formatServicePrice } from './format-service-price';
import type { ImeiCheckerColors } from './imei-check.types';
import { footerStyles as styles } from './imei-check-footer.styles';
import type { getImeiWalletCopy } from './imei-wallet-copy';

/**
 * The footer's "Pays from" line under the pay button. Every balance reads the
 * same way, "Pays from <source> · <amount>", so switching between store
 * credit and PiggyVest savings never looks like two different badges.
 * Unknown until the wallet loads (never a ₦0 that reads as empty).
 */
export function ImeiWalletBadge({
  colors,
  isWalletReady,
  needsTopUp,
  savingsKobo,
  statusText,
  walletBalance,
  walletCopy,
}: {
  colors: ImeiCheckerColors;
  isWalletReady: boolean;
  needsTopUp: boolean;
  savingsKobo: number | null;
  statusText: string | null;
  walletBalance: number;
  walletCopy: ReturnType<typeof getImeiWalletCopy>;
}) {
  const savings =
    savingsKobo === null ? null : formatServicePrice(savingsKobo / 100);
  const label = !isWalletReady
    ? (statusText ?? undefined)
    : savings !== null
      ? `Savings wallet balance ${savings}`
      : walletCopy.balanceLabel(walletBalance);
  const source = !isWalletReady
    ? null
    : savings !== null
      ? `PiggyVest savings · ${savings}`
      : `${walletCopy.badgePrefix ?? 'Wallet'} · ${formatServicePrice(walletBalance)}`;
  const tone = needsTopUp ? colors.error : colors.textSecondary;
  return (
    <View accessibilityLabel={label} style={styles.payFrom}>
      <Ionicons name="wallet-outline" size={15} color={tone} />
      <Text style={[styles.payFromText, { color: tone }]}>
        {source === null ? (
          '…'
        ) : (
          <>
            {'Pays from '}
            <Text
              style={[
                styles.payFromAmount,
                { color: needsTopUp ? colors.error : colors.text },
              ]}
            >
              {source}
            </Text>
          </>
        )}
      </Text>
    </View>
  );
}
