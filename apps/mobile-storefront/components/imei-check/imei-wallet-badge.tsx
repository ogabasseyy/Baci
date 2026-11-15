import Ionicons from '@react-native-vector-icons/ionicons';
import { Text, View } from 'react-native';
import { formatServicePrice } from './format-service-price';
import { styles } from './imei-check.styles';
import type { ImeiCheckerColors } from './imei-check.types';
import type { getImeiWalletCopy } from './imei-wallet-copy';

/**
 * The footer's wallet badge. Unknown until the wallet loads (never a ₦0 that
 * reads as empty); with paying from PiggyVest on, the savings wallet it pays
 * from; otherwise the store credit balance as before.
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
  const amount = !isWalletReady
    ? '…'
    : savings !== null
      ? `Savings ${savings}`
      : walletCopy.badgePrefix
        ? `${walletCopy.badgePrefix} ${formatServicePrice(walletBalance)}`
        : formatServicePrice(walletBalance);
  return (
    <View accessibilityLabel={label} style={styles.walletBadge}>
      <Ionicons
        name="wallet-outline"
        size={20}
        color={needsTopUp ? colors.error : colors.textSecondary}
      />
      <Text
        style={[
          styles.walletBadgeAmount,
          { color: needsTopUp ? colors.error : colors.text },
        ]}
      >
        {amount}
      </Text>
    </View>
  );
}
