import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text } from 'react-native';
import { styles } from '@/components/expenses/expenses-list.styles';
import { useTheme } from '@/hooks/useTheme';

interface ExpenseFilterChoiceProps {
  accessibilityLabel: string;
  label: string;
  onPress: () => void;
  selected: boolean;
}

export function ExpenseFilterChoice({
  accessibilityLabel,
  label,
  onPress,
  selected,
}: ExpenseFilterChoiceProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.filterSheetOption,
        {
          backgroundColor: selected ? colors.primaryLight : colors.card,
          borderColor: selected ? colors.primary : colors.border,
        },
      ]}
    >
      <Text style={{ color: colors.text }}>{label}</Text>
      {selected ? (
        <Ionicons color={colors.primary} name="checkmark" size={18} />
      ) : null}
    </Pressable>
  );
}
