import { CHECKOUT_PENDING_ORDER_STORAGE_KEY } from '@/components/storefront/ogabassey/pages/checkout/pending-checkout-order';
import { fetchWithCsrf } from '@/lib/api-client';
import type { CheckoutVerificationStatus } from './verify-checkout-payment-lookup';
import {
  isAbortError,
  isVerificationResponse,
  normalizeCurrencyCode,
  verifyCheckoutPaymentByLookup,
} from './verify-checkout-payment-lookup';

export type { CheckoutVerificationStatus };

export function hasMatchingPendingRedvaultOrder(
  orderId: string | null
): boolean {
  if (!orderId || typeof window === 'undefined') {
    return false;
  }

  try {
    const raw = sessionStorage.getItem(CHECKOUT_PENDING_ORDER_STORAGE_KEY);
    if (!raw) {
      return false;
    }
    const pendingOrder: unknown = JSON.parse(raw);
    if (!pendingOrder || typeof pendingOrder !== 'object') {
      return false;
    }
    const snapshot = pendingOrder as {
      orderId?: unknown;
      paymentMethod?: unknown;
    };
    return (
      snapshot.orderId === orderId && snapshot.paymentMethod === 'uba_redvault'
    );
  } catch {
    return false;
  }
}

// captured the money (mirrors finalizeOrderGatewayPayment kinds): never
// payment failures — the reverify loop keeps polling for completion.
const CAPTURED_PAYMENT_FINALIZATION_OUTCOMES = new Set([
  'completion_failed',
  'inventory_cleanup_failed',
  'inventory_failed',
  'order_fetch_failed',
  'review_failed',
]);

// Captured money with no active paid order left to complete: the finalizer
// filed a reconciliation review (order_cancelled) or the order was refunded
// (order_skipped). Terminal — repolling would return the same outcome —
// but never a confirmed order.
const RECONCILING_FINALIZATION_OUTCOMES = new Set([
  'order_cancelled',
  'order_skipped',
]);

export interface VerifyCheckoutPaymentParams {
  merchantSlug: string | undefined;
  orderId: string | null;
  paymentMethod: string | null;
  pendingRedvaultOrder: boolean;
  reference: string | null;
  trackingToken: string | null;
  /**
   * Per-pass bound owned by the hook: aborts a hung request so the lane
   * releases instead of stranding the page on "processing" forever.
   */
  signal?: AbortSignal;
}

export interface VerifyCheckoutPaymentHandlers {
  clearCart: () => void;
  redirectToCheckout: () => void;
  scheduleFailedRedirect: () => void;
  setIsVerifying: (isVerifying: boolean) => void;
  setOrderNumber: (orderNumber: string | null) => void;
  setPaymentMethod: (paymentMethod: string | null) => void;
  setStatus: (status: CheckoutVerificationStatus) => void;
  capturePaymentCompleted: (input: {
    currency?: string;
    orderId: string;
    orderNumber?: string;
    paymentMethod: string;
    reference?: string;
    total?: number;
  }) => void;
  capturePaymentFailed: (input: {
    orderId?: string | null;
    orderNumber?: string;
    paymentMethod?: string | null;
    reference?: string | null;
    reason: string;
  }) => void;
}

/**
 * Runs payment/order verification and maps every outcome onto the page state
 * via the supplied handlers. Module-scope so the try/finally blocks stay
 * outside the component body (React Compiler cannot lower try/finally yet).
 */
export async function verifyCheckoutPayment(
  {
    merchantSlug,
    orderId,
    paymentMethod,
    pendingRedvaultOrder,
    reference,
    trackingToken,
    signal,
  }: VerifyCheckoutPaymentParams,
  {
    clearCart,
    redirectToCheckout,
    scheduleFailedRedirect,
    setIsVerifying,
    setOrderNumber,
    setPaymentMethod,
    setStatus,
    capturePaymentCompleted,
    capturePaymentFailed,
  }: VerifyCheckoutPaymentHandlers
): Promise<void> {
  if (!reference) {
    const handled = await verifyCheckoutPaymentByLookup(
      {
        merchantSlug,
        orderId,
        paymentMethod,
        pendingRedvaultOrder,
        trackingToken,
        signal,
      },
      {
        clearCart,
        scheduleFailedRedirect,
        setIsVerifying,
        setOrderNumber,
        setPaymentMethod,
        setStatus,
        capturePaymentCompleted,
      }
    );
    if (!handled) {
      redirectToCheckout();
    }
    return;
  }

  setIsVerifying(true);

  try {
    const response = await fetchWithCsrf('/api/payments/verify', {
      body: JSON.stringify({ reference }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal,
    });
    const raw: unknown = await response.json();
    const data = isVerificationResponse(raw) ? raw : {};

    // A 202 or an explicit held/evidence/review code keeps the page
    // pending even when the payload also carries a success flag: the
    // capture has not settled and must not confirm the order.
    if (
      response.status === 202 ||
      data.code === 'REDVAULT_CAPTURE_HELD' ||
      data.code === 'REDVAULT_CAPTURE_EVIDENCE_REVIEW' ||
      data.code === 'REDVAULT_RECONCILIATION_REQUIRED' ||
      data.status === 'pending'
    ) {
      setStatus('pending');
      setOrderNumber(data.orderNumber || reference.slice(0, 8).toUpperCase());
    } else if (!response.ok) {
      if (
        typeof data.finalizationOutcome === 'string' &&
        CAPTURED_PAYMENT_FINALIZATION_OUTCOMES.has(data.finalizationOutcome)
      ) {
        // Order/inventory finalization failed after the provider captured
        // the money: the payment is not failed — reconciliation or the
        // next reverify pass can still complete it — so stay pending
        // instead of recording payment_failed and redirecting away.
        console.warn(
          'Payment captured but finalization failed; awaiting completion:',
          data.finalizationOutcome
        );
        setStatus('pending');
        setOrderNumber(data.orderNumber || reference.slice(0, 8).toUpperCase());
      } else {
        console.error('Payment verification failed:', data);
        setStatus('failed');
        capturePaymentFailed({
          orderId,
          orderNumber: data.orderNumber,
          paymentMethod: data.paymentMethod || paymentMethod,
          reference,
          reason: 'verification_failed',
        });
        scheduleFailedRedirect();
      }
    } else if (data.success && data.status === 'success') {
      // The verify API reports success for completed, order_cancelled, and
      // order_skipped outcomes alike: the latter two captured the money but
      // left no active paid order, so the shopper sees the
      // reconciliation/refund state — never a confirmed order — and the
      // cart stays intact for a fresh attempt.
      if (
        typeof data.finalizationOutcome === 'string' &&
        RECONCILING_FINALIZATION_OUTCOMES.has(data.finalizationOutcome)
      ) {
        setStatus('reconciling');
        setOrderNumber(data.orderNumber || reference.slice(0, 8).toUpperCase());
        if (data.paymentMethod) {
          setPaymentMethod(data.paymentMethod);
        }
        return;
      }
      clearCart();
      setStatus('success');
      setOrderNumber(data.orderNumber || reference.slice(0, 8).toUpperCase());
      const verifiedOrderId = data.orderId || orderId;
      // Only a completed finalization leaves an active paid order, so only
      // it counts as a paid conversion.
      if (verifiedOrderId && data.finalizationOutcome === 'completed') {
        const verifiedTotal = Number(data.orderTotal);
        const verifiedCurrency = normalizeCurrencyCode(data.currency);
        capturePaymentCompleted({
          orderId: verifiedOrderId,
          orderNumber: data.orderNumber,
          paymentMethod:
            data.paymentMethod || paymentMethod || 'payment_gateway',
          reference,
          ...(Number.isFinite(verifiedTotal) ? { total: verifiedTotal } : {}),
          ...(verifiedCurrency ? { currency: verifiedCurrency } : {}),
        });
      }
    } else if (data.status === 'failed' || data.status === 'cancelled') {
      setStatus('failed');
      capturePaymentFailed({
        orderId,
        orderNumber: data.orderNumber,
        paymentMethod: data.paymentMethod || paymentMethod,
        reference,
        reason:
          data.status === 'cancelled' ? 'payment_cancelled' : 'payment_failed',
      });
      scheduleFailedRedirect();
    } else {
      setStatus('pending');
      setOrderNumber(reference.slice(0, 8).toUpperCase());
    }
  } catch (error) {
    // An aborted bound is the loop working as intended — stay pending so
    // the hook schedules the retry — without error telemetry noise.
    if (!isAbortError(error)) {
      console.error('Failed to verify payment:', error);
    }
    setStatus('pending');
    setOrderNumber(reference.slice(0, 8).toUpperCase());
  } finally {
    setIsVerifying(false);
  }
}
