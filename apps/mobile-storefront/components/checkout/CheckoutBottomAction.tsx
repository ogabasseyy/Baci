import Ionicons from '@react-native-vector-icons/ionicons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type Colors from '@/constants/Colors';
import { BRAND } from '@/constants/Colors';
import { formatPrice } from '@/stores/cart-store';
import { checkoutScreenViewStyles as styles } from './CheckoutScreenView.styles';
import type { CheckoutStep } from './CheckoutStepper';
import type { PaymentMethodType } from './PaymentMethodSelector';

type ColorsScheme = (typeof Colors)['light'];

interface CheckoutBottomActionProps {
  animatedCtaArrowStyle: ComponentProps<typeof Animated.View>['style'];
  canContinue: boolean;
  colors: ColorsScheme;
  displayTotal: number;
  insetsBottom: number;
  isProcessing: boolean;
  itemCount: number;
  onContinue: () => void;
  onPlaceOrder: () => void;
  prizeSimulation?: boolean;
  selectedPayment: PaymentMethodType | null;
  step: CheckoutStep;
  total: number;
}

export function CheckoutBottomAction({
  animatedCtaArrowStyle,
  canContinue,
  colors,
  displayTotal,
  insetsBottom,
  isProcessing,
  itemCount,
  onContinue,
  onPlaceOrder,
  prizeSimulation = false,
  selectedPayment,
  step,
  total,
}: CheckoutBottomActionProps) {
  const isReview = step === 'review';
  const isReviewDisabled =
    isProcessing || (!prizeSimulation && !selectedPayment);
  const isActionDisabled = isReview ? isReviewDisabled : !canContinue;
  const useDisabledAppearance = isActionDisabled && !isProcessing;
  const actionColor = useDisabledAppearance ? colors.muted : BRAND.primary;
  const actionTextColor = useDisabledAppearance
    ? colors.textSecondary
    : BRAND.onPrimary;
  const reviewLabel = prizeSimulation
    ? 'Complete test checkout'
    : selectedPayment === 'invoice'
      ? 'Generate Invoice'
      : selectedPayment === 'payforme'
        ? 'Pay for Me'
        : 'Place Order';

  return (
    <View
      style={[
        styles.bottomAction,
        {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          paddingBottom: insetsBottom,
        },
      ]}
    >
      <View style={styles.bottomBar}>
        <View style={styles.bottomSummary}>
          <Text style={[styles.bottomLabel, { color: colors.textSecondary }]}>
            Total
          </Text>
          <Text style={[styles.bottomValue, { color: colors.text }]}>
            {formatPrice(displayTotal)}
          </Text>
          <Text style={[styles.bottomSubtle, { color: colors.textSecondary }]}>
            {itemCount} item{itemCount === 1 ? '' : 's'}
          </Text>
        </View>

        <Pressable
          style={[styles.actionButton, { backgroundColor: actionColor }]}
          onPress={isReview ? onPlaceOrder : onContinue}
          disabled={isActionDisabled}
          accessibilityRole="button"
          accessibilityLabel={
            isReview
              ? prizeSimulation
                ? 'Complete test prize checkout'
                : `${selectedPayment === 'invoice' ? 'Generate invoice' : selectedPayment === 'payforme' ? 'Prepare pay for me order' : 'Place order'} for ${formatPrice(total)}`
              : `Continue to ${step === 'address' ? 'payment' : 'review'}`
          }
          accessibilityState={{
            disabled: isActionDisabled,
            busy: isReview && isProcessing,
          }}
        >
          {isReview && isProcessing ? (
            <View style={styles.processingContainer}>
              <ActivityIndicator color={actionTextColor} size="small" />
              <Text
                style={[styles.actionButtonText, { color: actionTextColor }]}
              >
                Processing...
              </Text>
            </View>
          ) : (
            <>
              <Text
                style={[styles.actionButtonText, { color: actionTextColor }]}
              >
                {isReview ? reviewLabel : 'Continue'}
              </Text>
              <Animated.View style={animatedCtaArrowStyle}>
                <Ionicons
                  name="arrow-forward"
                  size={18}
                  color={actionTextColor}
                />
              </Animated.View>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}
