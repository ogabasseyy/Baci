import { Pressable, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { RADIUS, SPACING } from '@/constants/Colors';
import { triggerHaptic } from '@/hooks/use-haptics';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import type { QuickAmountOption } from './get-quick-amount-options';

/** Tap-to-fill amounts. Selecting one only changes the amount field. */
export function SavingsQuickAmounts({
  colors,
  disabled,
  onSelect,
  options,
  selectedAmount,
}: {
  colors: (typeof Colors)['light'];
  disabled: boolean;
  onSelect: (amount: number) => void;
  options: QuickAmountOption[];
  selectedAmount: number;
}) {
  if (options.length === 0) return null;
  return (
    <View style={styles.row}>
      {options.map((option) => {
        const selected = option.amount === selectedAmount;
        return (
          <Pressable
            key={`${option.label}-${option.amount}`}
            accessibilityRole="button"
            accessibilityLabel={`Use ${formatNgnCurrency(option.amount)}${option.spokenLabel ? `, ${option.spokenLabel}` : ''}`}
            accessibilityState={{ disabled, selected }}
            disabled={disabled}
            onPress={() => {
              triggerHaptic('selection');
              onSelect(option.amount);
            }}
            style={[
              styles.chip,
              {
                backgroundColor: selected
                  ? colors.primaryLowOpacity
                  : colors.card,
                borderColor: selected ? colors.primary : colors.border,
              },
              // Dimmed with the rest of the form while an add is in flight.
              disabled && styles.disabled,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.text,
                { color: selected ? colors.primary : colors.text },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.5 },
  row: { flexDirection: 'row', gap: SPACING.sm },
  chip: {
    alignItems: 'center',
    borderRadius: RADIUS.full,
    borderWidth: 1,
    justifyContent: 'center',
    flex: 1,
    minHeight: 44,
    minWidth: 0,
    paddingHorizontal: SPACING.xs,
  },
  text: { fontSize: 13, fontWeight: '600' },
});
