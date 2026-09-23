import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import type { AdminProductVariant } from '@/lib/product-picker-variant-rows';

interface ProductVariantSelectionFooterProps {
  colors: Pick<ThemeColors, 'primary' | 'text' | 'textMuted' | 'textOnPrimary'>;
  onAdd: () => void;
  selectedVariant: AdminProductVariant | null;
}

export function ProductVariantSelectionFooter({
  colors,
  onAdd,
  selectedVariant,
}: ProductVariantSelectionFooterProps) {
  const disabled = !selectedVariant;

  return (
    <View style={styles.container}>
      <View style={styles.selectionSummary}>
        <Text style={[styles.summaryLabel, { color: colors.textMuted }]}>
          Selected
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.summaryValue, { color: colors.text }]}
        >
          {selectedVariant?.name ?? 'Choose an option'}
        </Text>
      </View>
      <View
        style={[
          styles.addButton,
          {
            backgroundColor: colors.primary,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
      >
        <Pressable
          accessibilityLabel="Add selected variant"
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={onAdd}
          style={styles.addButtonPressable}
        >
          <Text style={[styles.addButtonText, { color: colors.textOnPrimary }]}>
            Add
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  addButton: {
    borderRadius: 8,
    overflow: 'hidden',
  },
  addButtonPressable: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 24,
  },
  addButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  selectionSummary: {
    flex: 1,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
});
