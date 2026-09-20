/**
 * Order Success Screen
 * Shown after successful order placement
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { OrderSuccessView } from '@/components/orders/OrderSuccessView';
import { isDeferredSettlementMethod } from '@/components/orders/order-success-content';
import { useGuestInvoicePaidState } from '@/components/orders/use-invoice-paid-state';
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
  // An invoice or Pay for Me order paid externally after checkout must not
  // keep showing proforma/request copy when the shopper returns: resolve
  // the authoritative paid state for deferred-settlement orders (guests
  // keep the method-based tone until their lookup settles).
  const { data: paidCheckOrder } = useReceiptDetail(
    isDeferredSettlementMethod(paymentMethod) && orderId ? orderId : null
  );
  const receiptPaidOrder = paidCheckOrder?.payment_status === 'paid';
  // Guests have no authenticated receipt query: resolve their paid state
  // through the tracking token so externally-paid invoices stop showing
  // proforma copy on return.
  const guestInvoicePaid = useGuestInvoicePaidState({
    orderId,
    paymentMethod,
    trackingToken,
    skip: receiptPaidOrder,
  });
  const isPaidOrder = receiptPaidOrder || guestInvoicePaid;
  // The proforma action opens this same preview: stamp the explicit kind so
  // the generated artifact and modal chrome read as a proforma, matching
  // the web success page (unpaid invoice orders only — paid orders keep the
  // commercial receipt even if this screen was reached via invoice).
  const isProformaDocument = paymentMethod === 'invoice' && !isPaidOrder;
  const receiptPreview = useReceiptPreview({
    documentKind: isProformaDocument ? 'proforma' : undefined,
  });
  // Asynchronous settlement (Juicyway on-chain detection, standard bank
  // transfers) is confirmed after the shopper leaves checkout: poll the
  // server-confirmed order state and complete the funnel only once this
  // order is paid.
  useSettlementCompletion({
    orderId,
    orderNumber,
    paymentMethod,
    reference,
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
        documentType={isProformaDocument ? 'proforma' : undefined}
        onClose={receiptPreview.closePreview}
      />
    </>
  );
}
