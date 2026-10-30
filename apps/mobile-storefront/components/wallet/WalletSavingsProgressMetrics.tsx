import { Text, View } from 'react-native';
import { BRAND, type default as Colors, withAlpha } from '@/constants/Colors';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { walletSavingsProgressModalStyles as styles } from './wallet-savings-progress-modal.styles';

type Props = {
  amountLeft: number;
  colors: (typeof Colors)['light'];
  goal: WalletActiveSavingsGoal;
  percent: number;
  percentLabel: string;
  progressAvailable: boolean;
};

export function WalletSavingsProgressMetrics({
  amountLeft,
  colors,
  goal,
  percent,
  percentLabel,
  progressAvailable,
}: Props) {
  return progressAvailable ? (
    <View
      style={[
        styles.progressCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.amountRow}>
        <Text style={[styles.amountLeft, { color: colors.text }]}>
          {formatNgnCurrency(goal.current_amount)} saved
        </Text>
        <Text style={[styles.walletBalance, { color: colors.textSecondary }]}>
          {formatNgnCurrency(goal.target_amount)} target
        </Text>
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Savings plan progress details"
        accessibilityValue={{
          max: 100,
          min: 0,
          now: percent,
          text: percentLabel,
        }}
        style={[
          styles.progressTrack,
          { backgroundColor: withAlpha(BRAND.primary, 0.16) },
        ]}
      >
        <View
          style={[
            styles.progressFill,
            { width: `${percent}%`, backgroundColor: BRAND.primary },
          ]}
        />
      </View>
      <View style={styles.amountRow}>
        <Text style={[styles.walletBalance, { color: colors.textSecondary }]}>
          {formatNgnCurrency(amountLeft)} left
        </Text>
        <Text style={[styles.walletBalance, { color: colors.textSecondary }]}>
          <Text style={{ color: BRAND.primary }}>{percentLabel}</Text> complete
        </Text>
      </View>
    </View>
  ) : (
    <Text style={{ color: colors.textSecondary }}>
      Savings progress and contributions are unavailable while earnings are
      being confirmed. Refresh your wallet and try again.
    </Text>
  );
}
