import { Text, View } from 'react-native';
import { styles } from '@/components/expenses/expenses-list.styles';
import { useTheme } from '@/hooks/useTheme';
import { formatCurrency } from '@/lib/utils';

interface ExpenseListSectionHeaderProps {
  count: number;
  currency: string;
  label: string;
  total: number;
  variant: 'month' | 'group';
}

export function ExpenseListSectionHeader({
  count,
  currency,
  label,
  total,
  variant,
}: ExpenseListSectionHeaderProps) {
  const { colors } = useTheme();
  const isGroup = variant === 'group';

  return (
    <View
      style={[
        isGroup ? styles.groupSectionHeader : styles.sectionHeader,
        { backgroundColor: colors.background },
      ]}
    >
      <Text
        accessibilityRole="header"
        ellipsizeMode="tail"
        numberOfLines={1}
        style={[
          isGroup ? styles.groupSectionHeaderLabel : styles.sectionHeaderLabel,
          { color: isGroup ? colors.text : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
      <View style={styles.sectionHeaderSummary}>
        <Text style={[styles.sectionHeaderTotal, { color: colors.text }]}>
          {formatCurrency(total, undefined, currency)}
        </Text>
        <Text style={[styles.sectionHeaderCount, { color: colors.textMuted }]}>
          {count} {count === 1 ? 'expense' : 'expenses'}
        </Text>
      </View>
    </View>
  );
}
