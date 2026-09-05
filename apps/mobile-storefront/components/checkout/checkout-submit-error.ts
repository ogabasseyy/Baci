import { router } from 'expo-router';
import { Alert } from 'react-native';
import type { PaymentMethodType } from '@/components/checkout/PaymentMethodSelector';
import { trackError } from '@/services/analytics';
import { OrderError } from '@/services/orders';
import { useCartStore } from '@/stores/cart-store';
import { selectRejectedVoucherLineIds } from './select-rejected-voucher-lines';

// Quiz-voucher rejection codes whose zero-priced cart line should be pruned on
// failure. Mirrors web checkout (`checkout-order-error-message.ts`). Excludes
// auth-required, quantity-invalid, config-missing and the multi-voucher
// conflict (`quiz_voucher_multiple`) — those leave a still-valid voucher that
// pruning would silently discard.
const QUIZ_VOUCHER_REJECTION_CODES = new Set([
  'quiz_voucher_award_invalid_type',
  'quiz_voucher_award_not_approved',
  'quiz_voucher_award_not_found',
  'quiz_voucher_invalid',
  'quiz_voucher_order_item_not_found',
  'quiz_voucher_token_expired',
  'quiz_voucher_token_invalid',
]);

// The orders API surfaces the specific voucher code in `error.details`
// (`details ?? code`); `error.code` itself is the generic 'VALIDATION_ERROR'.
function getQuizVoucherRejectionCode(error: OrderError): string | undefined {
  const raw = error.details;
  if (typeof raw !== 'string') return undefined;
  const code = raw.trim().toLowerCase();
  return QUIZ_VOUCHER_REJECTION_CODES.has(code) ? code : undefined;
}

// Without this, an expired/consumed voucher's zero-priced line stays in the
// cart and re-fails every subsequent checkout with no path back except manual
// removal. Prune ONLY the rejected voucher line (identified by the server) so a
// multi-prize cart never loses a still-valid voucher; see
// selectRejectedVoucherLineIds for the full policy.
function pruneRejectedQuizVoucherLines(error: OrderError): void {
  const cart = useCartStore.getState();
  const idsToPrune = selectRejectedVoucherLineIds(cart.items, {
    isRejection: Boolean(getQuizVoucherRejectionCode(error)),
    rejectedVoucherToken:
      typeof error.rejectedVoucherToken === 'string'
        ? error.rejectedVoucherToken
        : null,
  });
  for (const id of idsToPrune) {
    cart.removeItem(id);
  }
}

export function handleCheckoutSubmitError(
  error: unknown,
  selectedPayment: PaymentMethodType
) {
  if (error instanceof OrderError) {
    trackError('checkout_failed', error.message, {
      step: 'place_order',
      paymentMethod: selectedPayment,
      errorCode: error.code,
    });

    pruneRejectedQuizVoucherLines(error);

    if (
      error.code === 'CHECKOUT_ORDER_NOT_REUSABLE' ||
      error.code === 'CHECKOUT_IDEMPOTENCY_CONFLICT'
    ) {
      Alert.alert(
        'Check your existing order',
        'This checkout is already linked to an order whose status or details have changed. Check your orders before starting another purchase. If you checked out as a guest, use your order email or contact support.',
        [
          { text: 'View orders', onPress: () => router.push('/orders') },
          { text: 'Close', style: 'cancel' },
        ]
      );
      return;
    }
    if (error.code === 'NETWORK_ERROR') {
      Alert.alert(
        'No Connection',
        'Please check your internet connection and try again.',
        [{ text: 'OK' }]
      );
      return;
    }
    if (error.code === 'VALIDATION_ERROR') {
      Alert.alert(
        'Invalid Information',
        error.message || 'Please check your order details and try again.',
        [{ text: 'OK' }]
      );
      return;
    }
    if (error.code === 'AUTH_ERROR') {
      Alert.alert(
        'Session Expired',
        'Please sign in again to complete your order.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign In', onPress: () => router.push('/auth/login') },
        ]
      );
      return;
    }
    Alert.alert(
      'Order Failed',
      error.message || 'Something went wrong. Please try again.',
      [{ text: 'OK' }]
    );
    return;
  }

  trackError(
    'checkout_failed',
    error instanceof Error ? error.message : 'Unknown error',
    { step: 'place_order', paymentMethod: selectedPayment }
  );
  Alert.alert('Error', 'Failed to place order. Please try again.', [
    { text: 'OK' },
  ]);
}
