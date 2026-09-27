import { type RefObject, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { hasOrderSuccessIdentity } from '@/lib/order-success-identity';
import { maybeShowPostOrderInterstitial } from '@/lib/post-order-interstitial';
import { SERVER_CONFIRMED_ORDER_NOTIFICATION_METHODS } from '@/services/payment-status';
import { scheduleLocalNotification } from '@/services/push-notifications';
import { useOrderSuccessPermissionFlow } from './use-order-success-permission-flow';

interface OrderSuccessSideEffectsInput {
  isReconciliation: boolean;
  /**
   * Whether the deferred-order status is authoritative yet (and no
   * reconciliation-parameter verification is pending). All three side
   * effects wait for it: a slow refunded lookup must not lose a race
   * against the timers and notify, advertise, or soft-ask for an order
   * that is about to flip to reconciliation.
   */
  statusAuthoritative: boolean;
  orderId: string;
  orderNumber: string;
  paymentMethod: string;
  reference: string;
  isReceiptPreviewActiveRef: RefObject<boolean>;
  setFullscreenAdActive: (active: boolean) => void;
}

// Purchase-success side effects for the order-success screen: the order
// notification, the post-purchase interstitial, and the notification
// permission soft-ask. Extracted from OrderSuccessScreen so the screen
// stays under the 300-line limit; behavior is unchanged.
export function useOrderSuccessSideEffects({
  isReconciliation,
  statusAuthoritative,
  orderId,
  orderNumber,
  paymentMethod,
  reference,
  isReceiptPreviewActiveRef,
  setFullscreenAdActive,
}: OrderSuccessSideEffectsInput): {
  handlePermissionDeny: () => void;
  handlePermissionGrant: () => Promise<void>;
  isPermissionFlowActive: boolean;
  showPermissionModal: boolean;
} {
  const orderNotificationScheduledRef = useRef(false);
  const permissionFlowActiveRef = useRef(false);

  const {
    handlePermissionDeny,
    handlePermissionGrant,
    isPermissionFlowActive,
    showPermissionModal,
  } = useOrderSuccessPermissionFlow({
    isReconciliation,
    permissionFlowActiveRef,
    statusAuthoritative,
  });

  useEffect(() => {
    const isServerConfirmedNotificationMethod =
      SERVER_CONFIRMED_ORDER_NOTIFICATION_METHODS.has(paymentMethod);
    if (
      isReconciliation ||
      !statusAuthoritative ||
      orderNotificationScheduledRef.current ||
      !orderId
    ) {
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
      {
        type: 'order_update',
        orderNumber: notificationOrderNumber,
        orderId,
      },
      1
    ).catch((error) => {
      orderNotificationScheduledRef.current = false;
      console.warn('Failed to schedule order received notification', error);
    });
  }, [
    isReconciliation,
    statusAuthoritative,
    orderId,
    orderNumber,
    paymentMethod,
  ]);

  useEffect(() => {
    // Post-purchase interstitial (once per session, skipped while ads are
    // disabled). Delayed past the success animation like the soft ask below.
    // Abandoned if the shopper leaves before the ad loads so a late LOADED
    // event can never present over an unrelated screen — while the
    // notification permission flow is visible or in progress so the ad can
    // never cover the soft-ask modal or race the native prompt — and while
    // the receipt preview is loading or open so it never covers an
    // explicit document-viewing action.
    // A deep link or stale route with no success identity schedules
    // nothing: presenting would burn the once-per-session cap with no
    // completed order behind it. Reconciliation arrivals likewise present
    // nothing: no completed order sits behind them either.
    if (
      isReconciliation ||
      !statusAuthoritative ||
      !hasOrderSuccessIdentity({ orderId, orderNumber, reference })
    ) {
      return;
    }
    let interstitialCancelled = false;
    const interstitialTimerId = setTimeout(() => {
      void maybeShowPostOrderInterstitial({
        isCancelled: () =>
          interstitialCancelled ||
          permissionFlowActiveRef.current ||
          isReceiptPreviewActiveRef.current ||
          // A backgrounded shopper must never be greeted by the purchase
          // ad on resume: presenting while inactive surfaces it only when
          // the activity returns, outside the post-order moment.
          AppState.currentState !== 'active',
        onClosed: () => {
          if (!interstitialCancelled) setFullscreenAdActive(false);
        },
        onPresenting: () => {
          // show() resolves over a native bridge round-trip after
          // presentation begins; withhold the banner synchronously here
          // so it cannot request or record an impression underneath the
          // presenting interstitial.
          if (!interstitialCancelled) setFullscreenAdActive(true);
        },
      }).then((outcome) => {
        if (interstitialCancelled) return;
        // A failed presentation never produces CLOSED: release the
        // synchronously claimed withhold since no dismissal will arrive.
        setFullscreenAdActive(outcome === 'shown');
      });
    }, 2500);

    return () => {
      interstitialCancelled = true;
      clearTimeout(interstitialTimerId);
    };
  }, [
    isReconciliation,
    statusAuthoritative,
    orderId,
    orderNumber,
    reference,
    isReceiptPreviewActiveRef,
    setFullscreenAdActive,
  ]);

  return {
    handlePermissionDeny,
    handlePermissionGrant,
    isPermissionFlowActive,
    showPermissionModal,
  };
}
