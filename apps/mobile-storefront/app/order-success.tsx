/**
 * Order Success Screen
 * Shown after successful order placement
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { OrderSuccessView } from '@/components/orders/OrderSuccessView';
import { useSettlementCompletion } from '@/components/orders/use-settlement-completion';
import { ReceiptPreviewModal } from '@/components/receipts/ReceiptPreviewModal';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { usePermissionBooster } from '@/hooks/use-permission-booster';
import { useReceiptPreview } from '@/hooks/use-receipt-preview';
import { useReceiptDetail } from '@/hooks/use-receipts';
import { BACI_GOOGLE_REVIEW_URL } from '@/lib/post-purchase-actions';
import { SERVER_CONFIRMED_ORDER_NOTIFICATION_METHODS } from '@/services/payment-status';
import { scheduleLocalNotification } from '@/services/push-notifications';
import { useAuthStore } from '@/stores/auth-store';

const handleContinueShopping = (): void => {
  router.replace('/');
};

const handleLeaveGoogleReview = async (): Promise<void> => {
  try {
    await Linking.openURL(BACI_GOOGLE_REVIEW_URL);
  } catch {
    Alert.alert(
      'Unable to open review link',
      'Please try again in a browser later.'
    );
  }
};

export default function OrderSuccessScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const {
    orderId,
    orderNumber,
    reference,
    trackingToken,
    paymentMethod,
    deliveryEstimate,
  } = useLocalSearchParams<Record<string, string>>();
  const customer = useAuthStore((s) => s.customer);
  const orderNotificationScheduledRef = useRef(false);
  const receiptPreview = useReceiptPreview();
  // An invoice order paid externally after checkout must not keep showing
  // proforma copy when the shopper returns: resolve the authoritative paid
  // state for invoice-method orders (guests keep the method-based tone).
  const { data: paidCheckOrder } = useReceiptDetail(
    paymentMethod === 'invoice' && orderId ? orderId : null
  );
  const isPaidOrder = paidCheckOrder?.payment_status === 'paid';
  // Asynchronous settlement (Juicyway on-chain detection, standard bank
  // transfers) is confirmed after the shopper leaves checkout: poll the
  // server-confirmed order state and complete the funnel only once this
  // order is paid.
  useSettlementCompletion({
    orderId,
    orderNumber,
    paymentMethod,
    trackingToken,
  });

  const { requestPermission, triggerSystemPrompt, markDenied } =
    usePermissionBooster();
  const [showPermissionModal, setShowPermissionModal] = useState(false);

  useEffect(() => {
    const isServerConfirmedNotificationMethod =
      SERVER_CONFIRMED_ORDER_NOTIFICATION_METHODS.has(paymentMethod);
    if (orderNotificationScheduledRef.current || !orderId) {
      return;
    }

    if (isServerConfirmedNotificationMethod) {
      return;
    }

    const notificationOrderNumber = orderNumber?.trim() || orderId.trim();
    if (!notificationOrderNumber) {
      return;
    }

    orderNotificationScheduledRef.current = true;
    void scheduleLocalNotification(
      'Order Received! 📦',
      `Your order #${notificationOrderNumber} is being processed. We'll notify you when it ships.`,
      { type: 'order_update', orderNumber: notificationOrderNumber, orderId },
      1
    ).catch((error) => {
      orderNotificationScheduledRef.current = false;
      console.warn('Failed to schedule order received notification', error);
    });
  }, [orderId, orderNumber, paymentMethod]);

  useEffect(() => {
    // Check for notification permissions (Soft Ask)
    // Small delay to let the success animation play (better UX)
    const timerId = setTimeout(async () => {
      const result = await requestPermission('notifications');
      if (result === 'soft-ask-needed') {
        setShowPermissionModal(true);
      }
    }, 1500);

    return () => {
      clearTimeout(timerId);
    };
  }, [requestPermission]);

  const handlePermissionGrant = async () => {
    setShowPermissionModal(false);
    await triggerSystemPrompt('notifications');
  };

  const handlePermissionDeny = () => {
    setShowPermissionModal(false);
    markDenied('notifications');
  };

  const handleViewOrders = () => {
    if (!customer && trackingToken) {
      router.replace({
        pathname: '/track-order',
        params: { trackingToken },
      });
    } else {
      router.replace('/orders');
    }
  };

  const handleViewDocument = orderId
    ? () => {
        receiptPreview.openPreviewByOrderId(orderId);
      }
    : undefined;

  return (
    <>
      <OrderSuccessView
        colors={colors}
        deliveryEstimate={deliveryEstimate}
        isDark={colorScheme === 'dark'}
        isDocumentLoading={receiptPreview.isLoading}
        isPaid={isPaidOrder}
        onContinueShopping={handleContinueShopping}
        onLeaveGoogleReview={handleLeaveGoogleReview}
        onPermissionDeny={handlePermissionDeny}
        onPermissionGrant={handlePermissionGrant}
        onViewDocument={handleViewDocument}
        onViewOrders={handleViewOrders}
        orderNumber={orderNumber}
        paymentMethod={paymentMethod}
        reference={reference}
        showPermissionModal={showPermissionModal}
      />
      <ReceiptPreviewModal
        visible={receiptPreview.isOpen}
        html={receiptPreview.html}
        isPaid={receiptPreview.isPaid}
        onClose={receiptPreview.closePreview}
      />
    </>
  );
}
