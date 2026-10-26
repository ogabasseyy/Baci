import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import type { WalletData } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { SavingsProviderPreview } from './SavingsProviderPreview';
import { styles } from './wallet.styles';

export function WalletBalancePreview({
  wallet,
  colors,
  isError,
  onRetry,
}: {
  wallet: WalletData;
  colors: (typeof Colors)['light'];
  isError?: boolean;
  onRetry?: () => void;
}) {
  const cells = [
    {
      label: 'Earnings',
      amount: wallet.earnings_available
        ? formatNgnCurrency(wallet.earnings_balance ?? 0)
        : '—',
      icon: 'trending-up-outline' as const,
    },
    {
      label: 'Savings',
      amount: formatNgnCurrency(wallet.savings_balance ?? 0),
      icon: 'wallet-outline' as const,
    },
    {
      label: 'Loyalty',
      amount: `${wallet.loyalty_points.toLocaleString()} pts`,
      icon: 'star-outline' as const,
    },
  ];
  return (
    <View style={{ padding: 16 }}>
      <View style={styles.walletHero}>
        <SavingsProviderPreview />
        <View style={styles.balanceBlock}>
          <Text style={styles.balanceLabel}>Total Balance · NGN</Text>
          <Text
            style={styles.balanceAmount}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {formatNgnCurrency(wallet.total_balance ?? wallet.balance)}
          </Text>
        </View>
        <View style={styles.balanceSummaryRow}>
          {cells.map((cell) => (
            <View key={cell.label} style={styles.balanceSummaryCell}>
              <Ionicons
                name={cell.icon}
                size={18}
                color={colors.textSecondary}
              />
              <Text style={styles.balanceSummaryLabel}>{cell.label}</Text>
              <Text style={styles.balanceSummaryValue}>{cell.amount}</Text>
            </View>
          ))}
        </View>
        {isError ? (
          <Pressable accessibilityRole="button" onPress={onRetry}>
            <Text style={styles.accountUnavailableMessage}>
              Couldn’t load wallet details. Tap to retry.
            </Text>
          </Pressable>
        ) : (
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Loading account and activity"
          >
            <ActivityIndicator color={colors.textSecondary} />
            <Text style={styles.accountUnavailableMessage}>
              Loading account and activity…
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
