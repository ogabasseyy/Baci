import { fetchWithCsrf } from '@/lib/api-client';

type VerificationResponse = {
  code?: string;
  orderNumber?: string;
  status?: 'success' | 'pending' | 'failed' | 'cancelled';
  success?: boolean;
};

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
  const hasValidSuccess =
    candidate.success === undefined || typeof candidate.success === 'boolean';

  return hasValidStatus && hasValidOrderNumber && hasValidSuccess;
}

export type CheckoutVerificationStatus = 'success' | 'pending' | 'failed';

interface VerifyCheckoutPaymentParams {
  merchantSlug: string | undefined;
  orderId: string | null;
  pendingRedvaultOrder: boolean;
  reference: string | null;
  trackingToken: string | null;
}

interface VerifyCheckoutPaymentHandlers {
  clearCart: () => void;
  redirectToCheckout: () => void;
  scheduleFailedRedirect: () => void;
  setIsVerifying: (isVerifying: boolean) => void;
  setOrderNumber: (orderNumber: string | null) => void;
  setPaymentMethod: (paymentMethod: string | null) => void;
  setStatus: (status: CheckoutVerificationStatus) => void;
}

export async function verifyCheckoutPayment(
  {
    merchantSlug,
    orderId,
    pendingRedvaultOrder,
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
        if (
          data?.payment_method === 'uba_redvault' &&
          data.payment_status !== 'paid'
        ) {
          setPaymentMethod('uba_redvault');
          setStatus('pending');
          setOrderNumber(
            data.order_number ||
              data.short_id ||
              orderId.slice(0, 8).toUpperCase()
          );
        } else if (data && (data.order_number || data.short_id)) {
          clearCart();
          setStatus('success');
          setOrderNumber(data.order_number || data.short_id);
          if (data.payment_method) {
            setPaymentMethod(data.payment_method);
          }
        } else {
          if (pendingRedvaultOrder) {
            setPaymentMethod('uba_redvault');
            setStatus('pending');
            setOrderNumber(orderId.slice(0, 8).toUpperCase());
            return;
          }
          clearCart();
          setStatus('success');
          setOrderNumber(orderId.slice(0, 8).toUpperCase());
        }
      } catch (error) {
        console.error('Failed to fetch order details on success page:', error);
        if (pendingRedvaultOrder) {
          setPaymentMethod('uba_redvault');
          setStatus('pending');
          setOrderNumber(orderId.slice(0, 8).toUpperCase());
          return;
        }
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
      console.error('Payment verification failed:', data);
      setStatus('failed');
      scheduleFailedRedirect();
    } else if (data.success && data.status === 'success') {
      clearCart();
      setStatus('success');
      setOrderNumber(data.orderNumber || reference.slice(0, 8).toUpperCase());
    } else if (data.status === 'failed' || data.status === 'cancelled') {
      setStatus('failed');
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
