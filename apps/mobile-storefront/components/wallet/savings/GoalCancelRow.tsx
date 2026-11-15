import { Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import { styles } from './goal-cancel-step.styles';

type WalletColors = (typeof Colors)['light'];

export function GoalCancelRow({
  colors,
  label,
  value,
  total = false,
  struck = false,
}: {
  colors: WalletColors;
  label: string;
  value: number;
  total?: boolean;
  /** Money that does not come back: shown crossed out. */
  struck?: boolean;
}) {
  const tone = total ? colors.text : colors.textSecondary;
  return (
    <View
      style={[
        styles.row,
        total && [styles.totalRow, { borderTopColor: colors.border }],
      ]}
    >
      <Text style={[styles.rowText, { color: tone }, total && styles.bold]}>
        {label}
      </Text>
      <Text
        style={[
          styles.rowText,
          { color: struck ? colors.textSecondary : colors.text },
          total && styles.bold,
          struck && styles.struck,
        ]}
      >
        {formatNgnCurrency(value)}
      </Text>
    </View>
  );
}
