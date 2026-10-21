import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useCheckoutCtaAnimation } from '@/components/checkout/use-checkout-cta-animation';
import type Colors from '@/constants/Colors';
import { RADIUS } from '@/constants/Colors';
import styles from './styles';

interface CartCheckoutFooterProps {
  checkoutDotColor: string;
  colors: (typeof Colors)['light'];
  enableNegotiationModal: boolean;
  formatPrice: (amount: number) => string;
  grandTotal: number;
  hasAcceptedNegotiation: boolean;
  hasNonNegotiableItem?: boolean;
  isPreparingCheckout?: boolean;
  onCheckout: () => void;
  onCheckoutPressIn: () => void;
  onNegotiateTotal: () => void;
  surfaceInset: string;
}

export default function CartCheckoutFooter({
  checkoutDotColor,
  colors,
  enableNegotiationModal,
  formatPrice,
  grandTotal,
  hasAcceptedNegotiation,
  hasNonNegotiableItem = false,
  isPreparingCheckout = false,
  onCheckout,
  onCheckoutPressIn,
  onNegotiateTotal,
  surfaceInset,
}: CartCheckoutFooterProps) {
  const animatedArrowStyle = useCheckoutCtaAnimation(false, 600);

  return (
    <View
      style={[
        styles.checkoutStickyFooter,
        { backgroundColor: colors.card, borderTopColor: colors.border },
      ]}
    >
      <View
        style={[
          styles.bulkHint,
          { backgroundColor: surfaceInset, borderColor: colors.border },
        ]}
      >
        <Ionicons
          name="information-circle-outline"
          size={14}
          color={colors.textSecondary}
        />
        <Text style={[styles.bulkHintText, { color: colors.textSecondary }]}>
          Individual item negotiations take precedence over cart-wide discounts.
        </Text>
      </View>
      <View style={styles.footerActions}>
        {enableNegotiationModal && !hasNonNegotiableItem && (
          <Pressable
            style={({ pressed }) => [
              styles.bulkButton,
              { backgroundColor: surfaceInset, borderColor: colors.border },
              pressed && styles.bulkButtonPressed,
              hasAcceptedNegotiation && styles.bulkButtonDisabled,
            ]}
            onPress={onNegotiateTotal}
            accessibilityRole="button"
            accessibilityLabel="Negotiate cart total"
          >
            <View style={styles.bulkButtonContent}>
              <Ionicons
                name="cash-outline"
                size={22}
                color={
                  hasAcceptedNegotiation ? colors.textSecondary : colors.primary
                }
              />
              <Text
                style={[
                  styles.bulkButtonText,
                  { color: colors.primary },
                  hasAcceptedNegotiation && { color: colors.textSecondary },
                ]}
              >
                Negotiate
              </Text>
            </View>
          </Pressable>
        )}
        <Pressable
          style={styles.checkoutButtonContainer}
          onPressIn={onCheckoutPressIn}
          disabled={isPreparingCheckout}
          accessibilityState={{
            disabled: isPreparingCheckout,
            busy: isPreparingCheckout,
          }}
          onPress={onCheckout}
          accessibilityRole="button"
          accessibilityLabel={`Proceed to checkout, total ${formatPrice(grandTotal)}`}
        >
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: colors.primary,
                borderRadius: RADIUS.xl,
                borderWidth: 1.5,
                borderColor: colors.border,
              },
            ]}
          />
          <View style={styles.checkoutButtonContent}>
            <Text
              style={[
                styles.checkoutBtnLabel,
                { color: colors.primaryForeground },
              ]}
            >
              {isPreparingCheckout ? 'Syncing cart…' : 'Checkout'}
            </Text>
            <View
              style={[
                styles.checkoutBtnDot,
                { backgroundColor: checkoutDotColor },
              ]}
            />
            <Text
              style={[
                styles.checkoutBtnPrice,
                { color: colors.primaryForeground },
              ]}
            >
              {formatPrice(grandTotal || 0)}
            </Text>
            <Animated.View style={animatedArrowStyle}>
              <Ionicons
                name="arrow-forward"
                size={18}
                color={colors.primaryForeground}
              />
            </Animated.View>
          </View>
        </Pressable>
      </View>
    </View>
  );
}
