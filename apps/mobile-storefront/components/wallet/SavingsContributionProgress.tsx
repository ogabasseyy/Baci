import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { formatNgnCurrency } from '@/lib/format-ngn-currency';

/**
 * Covers the amount entry while a contribution is moving, from the tap
 * through the PIN until the transfer is confirmed or fails: one clear
 * "moving" state instead of a greyed-out form. It lies over the entry
 * (absolutely positioned), so the sheet keeps its size.
 */
export function SavingsContributionProgress({
  amount,
  colors,
}: {
  amount?: number;
  colors: (typeof Colors)['light'];
}) {
  const message =
    amount && amount > 0
      ? `Moving ${formatNgnCurrency(amount)} into your plan…`
      : 'Moving your money into your plan…';
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessibilityLabel={message}
      accessibilityState={{ busy: true }}
      testID="savings-contribution-progress"
      style={[styles.cover, { backgroundColor: colors.background }]}
    >
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={[styles.title, { color: colors.text }]}>{message}</Text>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        This usually takes a few seconds. Keep this open.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    gap: 10,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  title: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  hint: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
