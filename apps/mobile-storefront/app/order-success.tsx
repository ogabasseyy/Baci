/**
 * Order Success Screen
 * Shown after successful order placement
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking } from 'react-native';
import { OrderReconciliationView } from '@/components/orders/OrderReconciliationView';
import { OrderSuccessView } from '@/components/orders/OrderSuccessView';
import { isDeferredSettlementMethod } from '@/components/orders/order-success-content';
import { useGuestInvoicePaidState } from '@/components/orders/use-invoice-paid-state';
import { useOrderSuccessPermissionFlow } from '@/components/orders/use-order-success-permission-flow';
import { useSettlementCompletion } from '@/components/orders/use-settlement-completion';
import { verifyOrderPaymentForCompletion } from '@/components/payment-gateway/verify-order-payment';
import { ReceiptPreviewModal } from '@/components/receipts/ReceiptPreviewModal';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { MODAL_DISMISS_FALLBACK_MS } from '@/constants/modal-dismiss';
import { useReceiptPreview } from '@/hooks/use-receipt-preview';
import { useReceiptDetail } from '@/hooks/use-receipts';
import { hasOrderSuccessIdentity } from '@/lib/order-success-identity';
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
    reconciliation,
  } = useLocalSearchParams<Record<string, string>>();
  // Captured-but-cancelled/refunded arrivals (see the gateway completion
  // handlers): the money moved but no active paid order exists, so this
  // screen renders the reconciliation state with no settlement polling,
  // success notification, interstitial, or permission soft-ask.
  const isParamReconciliation =
    reconciliation === 'order_cancelled' || reconciliation === 'order_skipped';
  const customer = useAuthStore((s) => s.customer);
  const orderNotificationScheduledRef = useRef(false);
  // An invoice or Pay for Me order paid externally after checkout must not
  // keep showing proforma/request copy when the shopper returns: resolve
  // the authoritative paid state for deferred-settlement orders (guests
  // keep the method-based tone until their lookup settles).
  const needsDeferredStatus =
    isDeferredSettlementMethod(paymentMethod) && !!orderId;
  const { data: paidCheckOrder, isFetched: isReceiptCheckFetched } =
    useReceiptDetail(needsDeferredStatus ? (orderId ?? null) : null);
  const receiptPaymentStatus = paidCheckOrder?.payment_status;
  const receiptPaidOrder = receiptPaymentStatus === 'paid';
  const receiptRefundedOrder = receiptPaymentStatus === 'refunded';
  // The receipt query is disabled without a signed-in user: only wait for
  // it when it can actually run, otherwise the guest lookup below is the
  // authority.
  const receiptAuthoritative =
    !needsDeferredStatus || !customer || isReceiptCheckFetched;
  // Guests have no authenticated receipt query: resolve their paid state
  // through the tracking token so externally-paid invoices stop showing
  // proforma copy on return.
  const guestInvoice = useGuestInvoicePaidState({
    orderId,
    paymentMethod,
    trackingToken,
    skip: receiptPaidOrder,
  });
  const isPaidOrder = receiptPaidOrder || guestInvoice.status === 'paid';
  // A refunded invoice or Pay for Me order was previously paid: it must
  // never render proforma/request copy. Like a captured-but-cancelled
  // arrival it renders the reconciliation state — the money moved but no
  // active paid order exists.
  const wasPaidOrder =
    receiptRefundedOrder || guestInvoice.status === 'refunded';
  // Purchase-success side effects (notification, interstitial, permission
  // soft-ask) wait until the deferred-order status is authoritative: both
  // lookups begin unresolved, and a slow refunded lookup must not lose a
  // race against the 1.5–2.5s timers and open an ad or soft ask for an
  // order that is about to flip to reconciliation.
  const deferredStatusAuthoritative =
    receiptAuthoritative && guestInvoice.isResolved;
  // The reconciliation route parameter is caller-controlled (public
  // scheme/universal links): a crafted deep link must not render
  // "Payment Received" on its word alone. Verify it proof-bound before
  // rendering the reconciliation state; an unverified param falls
  // through to the ordinary success flow.
  const [paramReconciliationVerified, setParamReconciliationVerified] =
    useState<boolean | undefined>(undefined);
  useEffect(() => {
    setParamReconciliationVerified(undefined);
    if (!isParamReconciliation || !orderId) {
      return;
    }
    let cancelled = false;
    void verifyOrderPaymentForCompletion({
      orderId,
      trackingToken,
      reference,
    }).then((result) => {
      if (!cancelled) {
        setParamReconciliationVerified(!!result.reconciliation);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isParamReconciliation, orderId, trackingToken, reference]);
  const isParamVerificationPending =
    isParamReconciliation && paramReconciliationVerified === undefined;
  const isReconciliation =
    (isParamReconciliation && paramReconciliationVerified === true) ||
    wasPaidOrder;
  // The proforma action opens this same preview: stamp the explicit kind so
  // the generated artifact and modal chrome read as a proforma, matching
  // the web success page (unpaid invoice orders only — paid orders keep the
  // commercial receipt even if this screen was reached via invoice).
  const isProformaDocument =
    paymentMethod === 'invoice' && !isPaidOrder && !wasPaidOrder;
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
    disabled: isReconciliation,
  });

  // Tracks the notification permission flow (soft-ask modal through the
  // native prompt) independently of render state so the interstitial
  // cancellation predicate below always sees the current value.
  const permissionFlowActiveRef = useRef(false);
  const {
    handlePermissionDeny,
    handlePermissionGrant,
    isPermissionFlowActive,
    showPermissionModal,
  } = useOrderSuccessPermissionFlow({
    isReconciliation,
    permissionFlowActiveRef,
    statusAuthoritative:
      deferredStatusAuthoritative && !isParamVerificationPending,
  });
  // While a presented post-order interstitial owns the full screen the
  // success banner stays unmounted; cleared when the interstitial closes.
  const [isFullscreenAdActive, setFullscreenAdActive] = useState(false);
  // Same for the receipt preview: a late LOADED event must never present
  // the interstitial over an explicit document-viewing action.
  const receiptPreviewActiveRef = useRef(false);
  // iOS keeps the native receipt sheet rendered through its slide
  // dismissal, while closePreview clears the open state synchronously.
  // Hold receipt ownership until the modal reports dismissal so a late
  // LOADED event cannot present over the departing sheet and the banner
  // cannot remount underneath it.
  const [receiptDismissed, setReceiptDismissed] = useState(true);
  useEffect(() => {
    if (receiptPreview.isOpen) setReceiptDismissed(false);
  }, [receiptPreview.isOpen]);
  useEffect(() => {
    if (receiptPreview.isOpen || receiptPreview.isLoading || receiptDismissed)
      return undefined;
    const fallback = setTimeout(
      () => setReceiptDismissed(true),
      MODAL_DISMISS_FALLBACK_MS
    );
    return () => clearTimeout(fallback);
  }, [receiptPreview.isOpen, receiptPreview.isLoading, receiptDismissed]);
  const isReceiptPreviewActive =
    receiptPreview.isLoading || receiptPreview.isOpen || !receiptDismissed;
  receiptPreviewActiveRef.current = isReceiptPreviewActive;

  useEffect(() => {
    const isServerConfirmedNotificationMethod =
      SERVER_CONFIRMED_ORDER_NOTIFICATION_METHODS.has(paymentMethod);
    if (
      isReconciliation ||
      !deferredStatusAuthoritative ||
      isParamVerificationPending ||
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
      { type: 'order_update', orderNumber: notificationOrderNumber, orderId },
      1
    ).catch((error) => {
      orderNotificationScheduledRef.current = false;
      console.warn('Failed to schedule order received notification', error);
    });
  }, [
    isReconciliation,
    deferredStatusAuthoritative,
    isParamVerificationPending,
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
      !deferredStatusAuthoritative ||
      isParamVerificationPending ||
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
          receiptPreviewActiveRef.current ||
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
    deferredStatusAuthoritative,
    isParamVerificationPending,
    orderId,
    orderNumber,
    reference,
  ]);

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

  if (isParamVerificationPending) {
    // The reconciliation parameter is still unverified: render nothing
    // until the proof-bound check resolves — neither the success banner
    // (a spoofed param must not borrow its credibility) nor the
    // reconciliation state.
    return null;
  }

  if (isReconciliation) {
    return (
      <OrderReconciliationView
        colors={colors}
        isDark={colorScheme === 'dark'}
        orderNumber={orderNumber}
        onContinueShopping={handleContinueShopping}
        onViewOrders={handleViewOrders}
      />
    );
  }

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
        isReceiptPreviewActive={isReceiptPreviewActive}
        isPermissionFlowActive={isPermissionFlowActive}
        isFullscreenAdActive={isFullscreenAdActive}
        showPermissionModal={showPermissionModal}
      />
      <ReceiptPreviewModal
        visible={receiptPreview.isOpen}
        html={receiptPreview.html}
        isPaid={receiptPreview.isPaid}
        documentType={isProformaDocument ? 'proforma' : undefined}
        onClose={receiptPreview.closePreview}
        onDismissed={() => setReceiptDismissed(true)}
      />
    </>
  );
}
