import { Pressable, StyleSheet, Text } from 'react-native';
import { useOxygenColors } from './OxygenFormPrimitives';
export const oxygenPresentation = StyleSheet.create({
  section: { gap: 16, padding: 20 },
  title: { fontSize: 24, fontWeight: '700' },
  label: { fontSize: 16 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    minHeight: 48,
    fontSize: 18,
  },
});
export function OxygenAction({
  label,
  onPress,
  disabled = false,
  secondary = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  const colors = useOxygenColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 16,
        minHeight: 48,
        borderRadius: 12,
        opacity: disabled ? 0.5 : 1,
        backgroundColor: secondary ? colors.card : colors.primary,
        borderColor: colors.border,
        borderWidth: secondary ? 1 : 0,
      }}
    >
      <Text
        style={{
          color: secondary ? colors.text : colors.primaryForeground,
          fontWeight: '600',
          textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function oxygenMoney(amount: number): string {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 2,
  }).format(amount);
}
