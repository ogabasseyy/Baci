import { Pressable, Text } from 'react-native';
import type { ThemeColors } from '@/constants/theme';

export function PaidOrderSettlementAction({
  label,
  onPress,
  disabled,
  busy,
  workspaceFresh,
  allowWhenWorkspaceStale,
  colors,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  busy: boolean;
  workspaceFresh: boolean;
  allowWhenWorkspaceStale: boolean;
  colors: ThemeColors;
}) {
  const isDisabled =
    disabled || busy || (!workspaceFresh && !allowWhenWorkspaceStale);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={{
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: 12,
      }}
    >
      <Text style={{ color: isDisabled ? colors.textMuted : colors.primary }}>
        {label}
      </Text>
    </Pressable>
  );
}
