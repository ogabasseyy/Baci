import { StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { resolveColorSwatchValue } from '@/lib/cart-display';

export function WalletSavingsVariantBadges({
  label,
  colors,
}: {
  label?: string | null;
  colors: (typeof Colors)['light'];
}) {
  const parts =
    label
      ?.split('·')
      .map((part) => part.trim())
      .filter(Boolean) ?? [];
  return (
    <View style={styles.row}>
      {[...new Set(parts)].map((part) => {
        const isColour = /^colou?r\s*:/i.test(part);
        const value = part.replace(/^[^:]+:\s*/, '').trim();
        const swatch =
          isColour || !part.includes(':')
            ? resolveColorSwatchValue(value)
            : undefined;
        return swatch ? (
          <View
            key={part}
            accessible
            accessibilityRole="image"
            accessibilityLabel={value}
            style={[
              styles.swatch,
              { backgroundColor: swatch, borderColor: colors.textSecondary },
            ]}
          />
        ) : (
          <View
            key={part}
            style={[styles.chip, { backgroundColor: colors.muted }]}
          >
            <Text
              numberOfLines={1}
              style={[styles.label, { color: colors.textSecondary }]}
            >
              {value}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 26,
    overflow: 'hidden',
  },
  swatch: { width: 18, height: 18, borderRadius: 9, borderWidth: 1 },
  chip: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexShrink: 1,
  },
  label: { fontSize: 11, fontWeight: '600' },
});
