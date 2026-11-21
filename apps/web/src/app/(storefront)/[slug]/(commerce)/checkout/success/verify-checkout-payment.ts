import { CHECKOUT_PENDING_ORDER_STORAGE_KEY } from '@/components/storefront/ogabassey/pages/checkout/pending-checkout-order';
import { fetchWithCsrf } from '@/lib/api-client';
import { bankCardOfferReferenceSchema } from '@/schemas/bank-card-offer-reference';
import {
  bankCardOfferRetryDelay,
  getBankCardOfferCheckoutStatus,
} from './get-bank-card-offer-checkout-status';
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
// capture_hold_failed joins them: the hold record failed but the capture
// is durable, so the shopper must keep waiting, never re-pay.
const CAPTURED_PAYMENT_FINALIZATION_OUTCOMES = new Set([
  'capture_hold_failed',
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
  // The polling hook bounds this request.
  signal?: AbortSignal;
}

export interface VerifyCheckoutPaymentHandlers {
  clearCart: () => void;
  redirectToCheckout: () => void;
  scheduleFailedRedirect: () => void;
  setIsVerifying: (isVerifying: boolean) => void;
  setOrderNumber: (orderNumber: string | null) => void;
  setPaymentMethod: (paymentMethod: string | null) => void;
  setStatus: (
    status: CheckoutVerificationStatus,
    retryAfterMs?: number
  ) => void;
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
  const isBankOffer = bankCardOfferReferenceSchema.safeParse(reference).success;
  const fallbackOrderNumber = isBankOffer
    ? null
    : reference.slice(0, 8).toUpperCase();

  try {
    const response = await fetchWithCsrf('/api/payments/verify', {
      body: JSON.stringify({
        reference,
        ...(isBankOffer ? { merchantSlug } : {}),
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal,
    });
    const body = response.json();
    const raw: unknown = await (isBankOffer
      ? body.catch((error: unknown) => {
          if (!isAbortError(error)) {
            console.warn('Bank card offer verification returned invalid JSON', {
              status: response.status,
            });
          }
          return null;
        })
      : body);
    const data = isVerificationResponse(raw) ? raw : {};
    const orderNumber = data.orderNumber || fallbackOrderNumber;

    const bankOfferStatus = isBankOffer
      ? getBankCardOfferCheckoutStatus(response.status, data)
      : null;
    if (bankOfferStatus) {
      const retryDelay =
        bankOfferStatus === 'pending' && bankCardOfferRetryDelay(response);
      if (retryDelay) setStatus(bankOfferStatus, retryDelay);
      else setStatus(bankOfferStatus);
      // Only an ownership denial clears an already verified order number.
      if (bankOfferStatus === 'access_required') setOrderNumber(null);
      else if (response.status !== 403 && orderNumber)
        setOrderNumber(orderNumber);
      return;
    }

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
      if (orderNumber) setOrderNumber(orderNumber);
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
        if (orderNumber) setOrderNumber(orderNumber);
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
        if (orderNumber) setOrderNumber(orderNumber);
        if (data.paymentMethod) {
          setPaymentMethod(data.paymentMethod);
        }
        return;
      }
      clearCart();
      setStatus('success');
      if (orderNumber) setOrderNumber(orderNumber);
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
    } else if (
      data.status === 'failed' ||
      data.status === 'cancelled' ||
      data.status === 'abandoned'
    ) {
      // Terminal provider outcomes (abandoned = the shopper left the
      // Paystack page; the attempt can never settle): show the
      // failure/retry state with the matching failure event instead of
      // re-polling until the retry budget expires.
      setStatus('failed');
      capturePaymentFailed({
        orderId,
        orderNumber: data.orderNumber,
        paymentMethod: data.paymentMethod || paymentMethod,
        reference,
        reason:
          data.status === 'cancelled'
            ? 'payment_cancelled'
            : data.status === 'abandoned'
              ? 'payment_abandoned'
              : 'payment_failed',
      });
      scheduleFailedRedirect();
    } else {
      setStatus('pending');
      if (orderNumber) setOrderNumber(orderNumber);
    }
  } catch (error) {
    // An aborted bound is the loop working as intended — stay pending so
    // the hook schedules the retry — without error telemetry noise.
    if (!isAbortError(error)) {
      console.error('Failed to verify payment:', error);
    }
    setStatus('pending');
    if (fallbackOrderNumber) setOrderNumber(fallbackOrderNumber);
  } finally {
    setIsVerifying(false);
  }
}
