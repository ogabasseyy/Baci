import { Pressable, Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';

interface Props {
  colors: ThemeColors;
  disabled: boolean;
  onReload: () => void;
}

export function PaidOrderChangeUnreadableNotice({
  colors,
  disabled,
  onReload,
}: Props) {
  return (
    <View>
      <Text style={{ color: colors.text }}>
        The saved confirmation could not be read. Reload the order status before
        starting another change.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onReload}
        style={{
          minHeight: 44,
          justifyContent: 'center',
          paddingHorizontal: 12,
        }}
      >
        <Text style={{ color: disabled ? colors.textMuted : colors.primary }}>
          Reload order status
        </Text>
      </Pressable>
    </View>
  );
}
