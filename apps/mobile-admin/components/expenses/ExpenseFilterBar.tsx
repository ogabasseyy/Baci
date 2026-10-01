import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text } from 'react-native';
import { styles } from '@/components/expenses/expenses-list.styles';
import { useTheme } from '@/hooks/useTheme';

interface ExpenseFilterBarProps {
  activeFilterCount: number;
  onOpen: () => void;
}

export function ExpenseFilterBar({
  activeFilterCount,
  onOpen,
}: ExpenseFilterBarProps) {
  const { colors } = useTheme();
  const hasActiveFilters = activeFilterCount > 0;
  const accessibilityLabel = hasActiveFilters
    ? `Open expense filters (${activeFilterCount} active)`
    : 'Open expense filters';

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onOpen}
      style={[
        styles.filterButton,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Ionicons color={colors.textSecondary} name="options-outline" size={18} />
      <Text style={[styles.filterButtonText, { color: colors.text }]}>
        Filters
      </Text>
      {hasActiveFilters ? (
        <Text
          style={[
            styles.filterBadge,
            { backgroundColor: colors.primary, color: colors.card },
          ]}
        >
          {activeFilterCount}
        </Text>
      ) : null}
    </Pressable>
  );
}
