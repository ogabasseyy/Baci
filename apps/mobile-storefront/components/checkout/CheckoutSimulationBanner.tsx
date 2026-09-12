import { StyleSheet, Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { BRAND, RADIUS, SPACING } from '@/constants/Colors';

interface CheckoutSimulationBannerProps {
  colors: (typeof Colors)['light'];
}

export function CheckoutSimulationBanner({
  colors,
}: CheckoutSimulationBannerProps) {
  return (
    <View
      accessible
      accessibilityRole="alert"
      style={[
        styles.banner,
        { backgroundColor: colors.card, borderColor: BRAND.primary },
      ]}
    >
      <Text style={styles.title}>TEST SIMULATION</Text>
      <Text style={[styles.body, { color: colors.text }]}>
        Preview only. No order, payment, voucher, or inventory change will be
        created.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.xs,
    padding: SPACING.sm,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
  },
  title: {
    color: BRAND.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 3,
  },
});
