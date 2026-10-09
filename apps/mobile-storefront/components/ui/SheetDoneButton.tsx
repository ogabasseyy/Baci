import { Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/hooks/useTheme';

export function SheetDoneButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Done"
      onPress={onPress}
      style={[styles.button, { backgroundColor: colors.primary }]}
    >
      <Text style={[styles.label, { color: colors.primaryForeground }]}>
        Done
      </Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  button: {
    marginTop: 24,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 15, fontWeight: '600' },
});
