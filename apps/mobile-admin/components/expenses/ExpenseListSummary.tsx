import Ionicons from '@react-native-vector-icons/ionicons';
import { Text, View } from 'react-native';
import { styles } from '@/components/expenses/expenses-list.styles';
import { useTheme } from '@/hooks/useTheme';
import { formatCurrency } from '@/lib/utils';

interface ExpenseListSummaryProps {
  currency: string;
  label: string;
  total: number;
}

export function ExpenseListSummary({
  currency,
  label,
  total,
}: ExpenseListSummaryProps) {
  const { colors, shadows } = useTheme();

  return (
    <View style={styles.summaryContainer}>
      <View
        style={[
          styles.summaryCard,
          { backgroundColor: colors.primary },
          shadows.md,
        ]}
      >
        <Text
          style={[
            styles.summaryLabel,
            { color: colors.textOnPrimary, opacity: 0.8 },
          ]}
        >
          {label}
        </Text>
        <Text style={[styles.summaryAmount, { color: colors.textOnPrimary }]}>
          {formatCurrency(total, undefined, currency)}
        </Text>
        <View style={styles.summaryTrend}>
          <Ionicons
            name="trending-up"
            size={16}
            color={colors.textOnPrimary}
            style={{ opacity: 0.8 }}
          />
          <Text
            style={[
              styles.summaryTrendText,
              { color: colors.textOnPrimary, opacity: 0.8 },
            ]}
          >
            recorded spending
          </Text>
        </View>
      </View>
    </View>
  );
}
