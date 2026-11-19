import { router } from 'expo-router';
import { Alert } from 'react-native';
import { getCloseConfirmationMessage } from './payment-gateway-controller.helpers';
import { resolvePendingOrdersRoute } from './resolve-pending-orders-route';

export function createPaymentGatewayCloseHandler({
  customerId,
  orderId,
  paymentKind,
  paymentMethod,
  trackingToken,
  userId,
}: {
  customerId?: string;
  orderId?: string;
  paymentKind?: string;
  paymentMethod?: string;
  trackingToken?: string;
  userId?: string;
}) {
  return () => {
    Alert.alert('Cancel Payment?', getCloseConfirmationMessage(paymentKind), [
      { text: 'Continue Payment', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          if (paymentMethod === 'uba_redvault') {
            // Keep the existing live order attempt reachable rather than
            // returning to the populated checkout and risking a new order.
            router.replace(
              resolvePendingOrdersRoute({
                customerId,
                orderId,
                trackingToken,
                userId,
              })
            );
            return;
          }
          router.back();
        },
      },
    ]);
  };
}
