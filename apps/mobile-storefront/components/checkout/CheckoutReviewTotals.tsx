import { Text, View } from 'react-native';
import type Colors from '@/constants/Colors';
import { SHADOWS } from '@/constants/Colors';
import { formatPrice } from '@/stores/cart-store';
import { checkoutReviewStyles as styles } from './CheckoutReviewStep.styles';

interface CheckoutReviewTotalsProps {
  assuranceFee: number;
  colors: (typeof Colors)['light'];
  deliveryFee: number;
  isDark: boolean;
  /** A winner claiming a prize: delivery and VAT are on the merchant. */
  prizeCheckout?: boolean;
  subtotal: number;
  taxAmount: number | null;
  taxRate: number;
  total: number;
}

/** The subtotal, delivery, fees and total card on the review step. */
export function CheckoutReviewTotals({
  assuranceFee,
  colors,
  deliveryFee,
  isDark,
  prizeCheckout = false,
  subtotal,
  taxAmount,
  taxRate,
  total,
}: CheckoutReviewTotalsProps) {
  const cardSurface = {
    backgroundColor: colors.card,
    borderColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
    ...SHADOWS.sm,
  };
  const showTax = !prizeCheckout && taxAmount !== null && taxRate > 0;

  return (
    <View style={[styles.totalCard, cardSurface]}>
      <View style={styles.totalRow}>
        <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>
          Subtotal
        </Text>
        <Text style={[styles.totalValue, { color: colors.text }]}>
          {formatPrice(subtotal)}
        </Text>
      </View>
      <View style={styles.totalRow}>
        <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>
          Delivery
        </Text>
        <Text
          style={[styles.totalValue, { color: colors.text }]}
          testID="review-delivery-fee"
        >
          {prizeCheckout ? 'Free' : formatPrice(deliveryFee)}
        </Text>
      </View>
      {assuranceFee > 0 ? (
        <View style={styles.totalRow}>
          <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>
            Device Assurance
          </Text>
          <Text style={[styles.totalValue, { color: colors.text }]}>
            {formatPrice(assuranceFee)}
          </Text>
        </View>
      ) : null}
      {showTax && taxAmount !== null ? (
        <View style={styles.totalRow}>
          <Text style={[styles.totalLabel, { color: colors.textSecondary }]}>
            VAT ({(taxRate * 100).toFixed(1)}%)
          </Text>
          <Text style={[styles.totalValue, { color: colors.text }]}>
            {formatPrice(taxAmount)}
          </Text>
        </View>
      ) : null}
      <View
        style={[
          styles.totalRow,
          styles.grandTotalRow,
          { borderTopColor: colors.border },
        ]}
      >
        <Text style={[styles.grandTotalLabel, { color: colors.text }]}>
          Total
        </Text>
        <Text
          style={[styles.grandTotalValue, { color: colors.primary }]}
          testID="review-total"
        >
          {formatPrice(prizeCheckout ? 0 : total)}
        </Text>
      </View>
    </View>
  );
}
