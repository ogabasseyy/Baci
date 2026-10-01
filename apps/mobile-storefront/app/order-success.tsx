/**
 * Order Success Screen
 * Shown after successful order placement
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { OrderReconciliationView } from '@/components/orders/OrderReconciliationView';
import { OrderSuccessView } from '@/components/orders/OrderSuccessView';
import { isDeferredSettlementMethod } from '@/components/orders/order-success-content';
import { renderParamVerificationGate } from '@/components/orders/param-verification-gate';
import { useDeferredOrderStatusAuthority } from '@/components/orders/use-deferred-order-status-authority';
import { useOrderSuccessCompletionPolling } from '@/components/orders/use-order-success-completion-polling';
import { useOrderSuccessSideEffects } from '@/components/orders/use-order-success-side-effects';
import { useParamReconciliationVerification } from '@/components/orders/use-param-reconciliation-verification';
import { ReceiptPreviewModal } from '@/components/receipts/ReceiptPreviewModal';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { MODAL_DISMISS_FALLBACK_MS } from '@/constants/modal-dismiss';
import { useReceiptPreview } from '@/hooks/use-receipt-preview';
import { BACI_GOOGLE_REVIEW_URL } from '@/lib/post-purchase-actions';
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
  // An invoice or Pay for Me order paid externally after checkout must not
  // keep showing proforma/request copy when the shopper returns: resolve
  // the authoritative paid state for deferred-settlement orders (guests
  // keep the method-based tone until their lookup settles).
  const needsDeferredStatus =
    isDeferredSettlementMethod(paymentMethod) && !!orderId;
  // Authority split: the authenticated receipt query owns signed-in
  // status (only on a successful result — a failed request must not
  // render paid/refunded as unpaid with side effects enabled); the
  // tracking-token guest lookup runs only with no authenticated
  // customer.
  const {
    deferredStatusAuthoritative,
    guestInvoice,
    isCancelledOrder,
    isPaidOrder,
    receiptAmountPaid,
    receiptPaymentMethod,
    receiptPaymentStatus,
  } = useDeferredOrderStatusAuthority({
    customer,
    needsDeferredStatus,
    orderId,
    paymentMethod,
    trackingToken,
  });
  const receiptRefundedOrder = receiptPaymentStatus === 'refunded';
  // A refunded invoice or Pay for Me order was previously paid: it must
  // never render proforma/request copy. Like a captured-but-cancelled
  // arrival it renders the reconciliation state — the money moved but no
  // active paid order exists.
  const wasPaidOrder =
    receiptRefundedOrder || guestInvoice.status === 'refunded';
  // A cancelled invoice or Pay for Me order cannot be fulfilled: like a
  // refund it renders reconciliation — never proforma/request copy with
  // live payment instructions, and never success side effects.
  // Partially paid accepted money without settling: commercial
  // presentation, but the order stays active — never the reconciliation
  // state above.
  const isPartiallyPaidOrder =
    receiptPaymentStatus === 'partially_paid' ||
    guestInvoice.status === 'partially_paid';
  // Pre-gateway wallet/savings credit recorded in amount_paid while the
  // status stays unpaid/pending: same accepted-value evidence, so the
  // same commercial presentation on both authenticated and guest paths.
  const isCreditedOrder =
    receiptAmountPaid > 0 || guestInvoice.status === 'credited';
  // The reconciliation route parameter is caller-controlled (public
  // scheme/universal links): a crafted deep link must not render
  // "Payment Received" on its word alone. Verified proof-bound (with
  // bounded retries for transient failures) before rendering the
  // reconciliation state; a verified-absent param falls through to the
  // ordinary success flow, while an inconclusive lookup stays pending
  // instead of coercing to either view.
  const {
    verified: paramReconciliationVerified,
    exhausted: isParamVerificationExhausted,
    retry: retryParamVerification,
  } = useParamReconciliationVerification({
    isParamReconciliation,
    orderId,
    trackingToken,
    reference,
  });
  const isParamVerificationUnresolved =
    isParamReconciliation && paramReconciliationVerified === undefined;
  const isReconciliation =
    (isParamReconciliation && paramReconciliationVerified === true) ||
    wasPaidOrder ||
    isCancelledOrder;
  // The proforma action opens this same preview: stamp the explicit kind so
  // the generated artifact and modal chrome read as a proforma, matching
  // the web success page (unpaid invoice orders only — paid orders keep the
  // commercial receipt even if this screen was reached via invoice). The
  // route method is caller-controlled, so once the authenticated receipt
  // lookup resolves, the stored method must agree: a stale or crafted
  // invoice link for a card/Pay-for-Me/bank-transfer order must not
  // relabel its preview as a proforma.
  const storedMethodAgrees =
    receiptPaymentMethod === undefined || receiptPaymentMethod === 'invoice';
  const isProformaDocument =
    paymentMethod === 'invoice' &&
    storedMethodAgrees &&
    !isPaidOrder &&
    !wasPaidOrder &&
    !isCancelledOrder &&
    !isPartiallyPaidOrder &&
    !isCreditedOrder;
  const receiptPreview = useReceiptPreview({
    documentKind: isProformaDocument ? 'proforma' : undefined,
  });
  // Server-confirmation polling (async settlement paid-completion and
  // delivery-gated invoice_generated capture) lives in a dedicated hook
  // so this screen stays under the 300-line route limit.
  useOrderSuccessCompletionPolling({
    customerEmail: customer?.email,
    disabled: isReconciliation,
    orderId,
    orderNumber,
    paymentMethod,
    reference,
    trackingToken,
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

  // Purchase-success side effects (order notification, post-purchase
  // interstitial, permission soft-ask) live in a dedicated hook so this
  // screen stays under the 300-line limit; all three wait for an
  // authoritative deferred status.
  const {
    handlePermissionDeny,
    handlePermissionGrant,
    isPermissionFlowActive,
    showPermissionModal,
  } = useOrderSuccessSideEffects({
    isReconciliation,
    statusAuthoritative:
      deferredStatusAuthoritative && !isParamVerificationUnresolved,
    orderId,
    orderNumber,
    paymentMethod,
    reference,
    isReceiptPreviewActiveRef: receiptPreviewActiveRef,
    setFullscreenAdActive,
  });

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

  // The preview loads through the authenticated receipt query, which is
  // disabled without a signed-in user: offering the action to a guest
  // would stick the button on "Preparing document..." forever. The
  // tracking-token lookup cannot substitute — it returns a summary
  // without the settlement-critical document fields (order virtual
  // account, transactions, merchant banking). Guests reach their order
  // through View orders (tracking-token route) instead.
  const handleViewDocument =
    orderId && customer
      ? () => {
          receiptPreview.openPreviewByOrderId(orderId);
        }
      : undefined;

  const paramVerificationGate = renderParamVerificationGate({
    isParamReconciliation,
    paramReconciliationVerified,
    isParamVerificationExhausted,
    retryParamVerification,
    colors,
    isDark: colorScheme === 'dark',
    orderNumber,
    onContinueShopping: handleContinueShopping,
  });
  if (paramVerificationGate !== undefined) {
    return paramVerificationGate;
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
        isCommercialDocument={isPartiallyPaidOrder || isCreditedOrder}
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
        // Same kind the artifact was generated with (explicit proforma
        // action, derived proforma, or commercial fallback) — never a
        // second local derivation that can disagree with the HTML.
        documentType={receiptPreview.documentKind}
        onClose={receiptPreview.closePreview}
        onDismissed={() => setReceiptDismissed(true)}
      />
    </>
  );
}
