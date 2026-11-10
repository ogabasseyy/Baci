import { Pressable, StyleSheet, Text } from 'react-native';
import type Colors from '@/constants/Colors';

export function GoalLifecycleAction({
  colors,
  label,
  onPress,
  primary = false,
  busy = false,
}: {
  colors: (typeof Colors)['light'];
  label: string;
  onPress: () => void;
  primary?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      style={[
        styles.button,
        primary
          ? { backgroundColor: colors.primary }
          : { borderColor: colors.border, borderWidth: 1 },
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: primary ? colors.primaryForeground : colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 44,
  },
  text: { fontSize: 14, fontWeight: '600' },
});
