import { StyleSheet, Text, View } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND, RADIUS, SPACING } from '@/constants/Colors';
import type { CartItem } from '@/stores/cart-store';
import { CheckoutSimulationBanner } from './CheckoutSimulationBanner';
import { isPrizeOnlyCheckout } from './checkout-prize-display';

interface CheckoutPrizeNoticeProps {
  items: CartItem[];
  simulation: boolean;
}

/**
 * The banner above checkout for prize orders: the test-simulation warning in
 * simulation mode, or a "free prize" reassurance when a winner is claiming.
 */
export function CheckoutPrizeNotice({
  items,
  simulation,
}: CheckoutPrizeNoticeProps) {
  const colors = Colors[useColorScheme() ?? 'light'];
  if (simulation) {
    return <CheckoutSimulationBanner colors={colors} />;
  }
  if (!isPrizeOnlyCheckout(items)) {
    return null;
  }

  return (
    <View
      accessible
      style={[
        styles.banner,
        { backgroundColor: colors.card, borderColor: BRAND.primary },
      ]}
    >
      <Text style={styles.title}>YOUR PRIZE IS FREE</Text>
      <Text style={[styles.body, { color: colors.text }]}>
        Delivery is on us. You will not be charged, whichever payment method is
        selected.
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
