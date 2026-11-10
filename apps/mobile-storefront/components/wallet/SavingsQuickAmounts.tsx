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
            accessibilityLabel={`Use ${formatNgnCurrency(option.amount)}${option.label.startsWith('₦') ? '' : `, ${option.label.toLowerCase()}`}`}
            accessibilityState={{ disabled, selected }}
            disabled={disabled}
            onPress={() => {
              triggerHaptic('selection');
              onSelect(option.amount);
            }}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? colors.primary : colors.card,
                borderColor: selected ? colors.primary : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.text,
                { color: selected ? colors.primaryForeground : colors.text },
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
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chip: {
    alignItems: 'center',
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    justifyContent: 'center',
    flexGrow: 1,
    minHeight: 44,
    paddingHorizontal: SPACING.md,
  },
  text: { fontSize: 13, fontWeight: '600' },
});
