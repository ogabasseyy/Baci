import Ionicons from '@react-native-vector-icons/ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BRAND, palette } from '@/constants/Colors';
import type { StartSavingsColors } from './start-savings.types';

export type SavingsChoice<T> = {
  value: T;
  label: string;
  /** Read out in full; defaults to the label. */
  accessibilityLabel?: string;
  /** Optional icon shown before the label (replaced by the tick when chosen). */
  icon?: ComponentProps<typeof Ionicons>['name'];
};

type Props<T> = {
  colors: StartSavingsColors;
  options: readonly SavingsChoice<T>[];
  selected: T | null;
  onSelect: (value: T) => void;
  disabled?: boolean;
  accessibilityLabel: string;
};

/**
 * Side-by-side answer cards. The chosen card is filled brand red with a tick,
 * so the answer is obvious at a glance; the others stay plain.
 */
export function SavingsChoiceCards<T extends string | boolean>({
  colors,
  options,
  selected,
  onSelect,
  disabled = false,
  accessibilityLabel,
}: Props<T>) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={styles.row}
    >
      {options.map((option) => {
        const active = option.value === selected;
        return (
          <Pressable
            key={String(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ selected: active, checked: active, disabled }}
            disabled={disabled}
            onPress={() => onSelect(option.value)}
            style={[
              styles.card,
              active
                ? styles.active
                : { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {active ? (
              <View style={styles.tick}>
                <Ionicons name="checkmark" size={12} color={BRAND.primary} />
              </View>
            ) : option.icon ? (
              <Ionicons name={option.icon} size={16} color={BRAND.primary} />
            ) : null}
            <Text
              style={[
                styles.label,
                { color: active ? palette.white : colors.text },
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
  row: { flexDirection: 'row', gap: 10 },
  card: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  active: { backgroundColor: BRAND.primary, borderColor: BRAND.primary },
  tick: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
