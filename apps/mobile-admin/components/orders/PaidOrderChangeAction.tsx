import { Pressable, Text } from 'react-native';
import { SPACING } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';

export function PaidOrderChangeAction({
  label,
  onPress,
  disabled,
  selected,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  selected?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 44,
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.border,
        borderRadius: 8,
        padding: SPACING.sm,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Text style={{ color: colors.primary }}>{label}</Text>
    </Pressable>
  );
}
