/**
 * Order Success Screen
 * Shown after successful order placement
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { OrderSuccessView } from '@/components/orders/OrderSuccessView';
import { ReceiptPreviewModal } from '@/components/receipts/ReceiptPreviewModal';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { usePermissionBooster } from '@/hooks/use-permission-booster';
import { useReceiptPreview } from '@/hooks/use-receipt-preview';
import { maybeShowPostOrderInterstitial } from '@/lib/post-order-interstitial';
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

  const { requestPermission, triggerSystemPrompt, markDenied } =
    usePermissionBooster();
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  // Tracks the notification permission flow (soft-ask modal through the
  // native prompt) independently of render state so the interstitial
  // cancellation predicate below always sees the current value.
  const permissionFlowActiveRef = useRef(false);
  // Same for the receipt preview: a late LOADED event must never present
  // the interstitial over an explicit document-viewing action.
  const receiptPreviewActiveRef = useRef(false);
  receiptPreviewActiveRef.current =
    receiptPreview.isLoading || receiptPreview.isOpen;

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
    // Post-purchase interstitial (once per session, skipped while ads are
    // disabled). Delayed past the success animation like the soft ask below.
    // Abandoned if the shopper leaves before the ad loads so a late LOADED
    // event can never present over an unrelated screen — while the
    // notification permission flow is visible or in progress so the ad can
    // never cover the soft-ask modal or race the native prompt — and while
    // the receipt preview is loading or open so it never covers an
    // explicit document-viewing action.
    let interstitialCancelled = false;
    const interstitialTimerId = setTimeout(() => {
      void maybeShowPostOrderInterstitial({
        isCancelled: () =>
          interstitialCancelled ||
          permissionFlowActiveRef.current ||
          receiptPreviewActiveRef.current,
      });
    }, 2500);

    return () => {
      interstitialCancelled = true;
      clearTimeout(interstitialTimerId);
    };
  }, []);

  useEffect(() => {
    // Check for notification permissions (Soft Ask)
    // Small delay to let the success animation play (better UX).
    // The flag is set before awaiting the permission lookup: on a slow
    // device the native-module import or status check can still be pending
    // past the interstitial timer, and the ad must not present just as the
    // soft ask opens. Terminal non-modal results clear it immediately.
    const timerId = setTimeout(async () => {
      permissionFlowActiveRef.current = true;
      const result = await requestPermission('notifications');
      if (result === 'soft-ask-needed') {
        setShowPermissionModal(true);
      } else {
        permissionFlowActiveRef.current = false;
      }
    }, 1500);

    return () => {
      clearTimeout(timerId);
    };
  }, [requestPermission]);

  const handlePermissionGrant = async () => {
    setShowPermissionModal(false);
    await triggerSystemPrompt('notifications');
    permissionFlowActiveRef.current = false;
  };

  const handlePermissionDeny = () => {
    setShowPermissionModal(false);
    permissionFlowActiveRef.current = false;
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
        onContinueShopping={handleContinueShopping}
        onLeaveGoogleReview={handleLeaveGoogleReview}
        onPermissionDeny={handlePermissionDeny}
        onPermissionGrant={handlePermissionGrant}
        onViewDocument={handleViewDocument}
        onViewOrders={handleViewOrders}
        orderNumber={orderNumber}
        paymentMethod={paymentMethod}
        reference={reference}
        isReceiptPreviewActive={
          receiptPreview.isLoading || receiptPreview.isOpen
        }
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
