import { fetchWithCsrf } from '@/lib/api-client';

type VerificationResponse = {
  currency?: string;
  orderId?: string;
  orderNumber?: string;
  orderTotal?: number;
  paymentMethod?: string;
  status?: 'success' | 'pending' | 'failed' | 'cancelled';
  success?: boolean;
  finalizationOutcome?: string;
};

function normalizeCurrencyCode(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  return normalized || undefined;
}

function isVerificationResponse(value: unknown): value is VerificationResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const hasValidStatus =
    candidate.status === undefined ||
    candidate.status === 'success' ||
    candidate.status === 'pending' ||
    candidate.status === 'failed' ||
    candidate.status === 'cancelled';
  const hasValidOrderNumber =
    candidate.orderNumber === undefined ||
    typeof candidate.orderNumber === 'string';
  const hasValidOrderId =
    candidate.orderId === undefined || typeof candidate.orderId === 'string';
  const hasValidPaymentMethod =
    candidate.paymentMethod === undefined ||
    typeof candidate.paymentMethod === 'string';
  const hasValidSuccess =
    candidate.success === undefined || typeof candidate.success === 'boolean';
  const hasValidFinalizationOutcome =
    candidate.finalizationOutcome === undefined ||
    typeof candidate.finalizationOutcome === 'string';

  return (
    hasValidStatus &&
    hasValidOrderNumber &&
    hasValidOrderId &&
    hasValidPaymentMethod &&
    hasValidSuccess &&
    hasValidFinalizationOutcome
  );
}

export type CheckoutVerificationStatus = 'success' | 'pending' | 'failed';

// captured the money (mirrors finalizeOrderGatewayPayment kinds): never
// payment failures — the reverify loop keeps polling for completion.
const CAPTURED_PAYMENT_FINALIZATION_OUTCOMES = new Set([
  'completion_failed',
  'inventory_cleanup_failed',
  'inventory_failed',
  'order_fetch_failed',
  'review_failed',
]);

export interface VerifyCheckoutPaymentParams {
  merchantSlug: string | undefined;
  orderId: string | null;
  paymentMethod: string | null;
  reference: string | null;
  trackingToken: string | null;
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
    reference,
    trackingToken,
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
    if (orderId) {
      setIsVerifying(true);
      try {
        const query = new URLSearchParams();
        if (merchantSlug) query.set('merchant_slug', merchantSlug);
        if (trackingToken) query.set('tracking_token', trackingToken);
        const queryString = query.toString();
        const url = `/api/storefront/orders/${encodeURIComponent(orderId)}${
          queryString ? `?${queryString}` : ''
        }`;
        const response = await fetch(url);
        const data = response.ok ? await response.json() : null;
        if (data && (data.order_number || data.short_id)) {
          clearCart();
          setStatus('success');
          setOrderNumber(data.order_number || data.short_id);
          if (data.payment_method) {
            setPaymentMethod(data.payment_method);
          }
          if (data.payment_status === 'paid') {
            const lookupTotal = Number(data.total);
            const lookupCurrency = normalizeCurrencyCode(data.currency);
            capturePaymentCompleted({
              orderId,
              orderNumber: data.order_number || data.short_id,
              paymentMethod:
                data.payment_method || paymentMethod || 'paid_order',
              ...(Number.isFinite(lookupTotal) ? { total: lookupTotal } : {}),
              ...(lookupCurrency ? { currency: lookupCurrency } : {}),
            });
          }
        } else {
          // Fallback if API lookup fails
          clearCart();
          setStatus('success');
          setOrderNumber(orderId.slice(0, 8).toUpperCase());
        }
      } catch (error) {
        console.error('Failed to fetch order details on success page:', error);
        clearCart();
        setStatus('success');
        setOrderNumber(orderId.slice(0, 8).toUpperCase());
      } finally {
        setIsVerifying(false);
      }
      return;
    }

    redirectToCheckout();
    return;
  }

  setIsVerifying(true);

  try {
    const response = await fetchWithCsrf('/api/payments/verify', {
      body: JSON.stringify({ reference }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const raw: unknown = await response.json();
    const data = isVerificationResponse(raw) ? raw : {};

    if (data.status === 'pending') {
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
      clearCart();
      setStatus('success');
      setOrderNumber(data.orderNumber || reference.slice(0, 8).toUpperCase());
      const verifiedOrderId = data.orderId || orderId;
      // The verify API reports success for completed, order_cancelled, and
      // order_skipped outcomes alike: only a completed finalization leaves an
      // active paid order, so only it counts as a paid conversion.
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
    console.error('Failed to verify payment:', error);
    setStatus('pending');
    setOrderNumber(reference.slice(0, 8).toUpperCase());
  } finally {
    setIsVerifying(false);
  }
}
