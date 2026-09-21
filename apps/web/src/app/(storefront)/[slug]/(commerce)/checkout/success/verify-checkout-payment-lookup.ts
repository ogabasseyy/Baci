export type CheckoutVerificationStatus =
  | 'success'
  | 'pending'
  | 'failed'
  | 'reconciling';

export type VerificationResponse = {
  code?: string;
  currency?: string;
  orderId?: string;
  orderNumber?: string;
  orderTotal?: number;
  paymentMethod?: string;
  status?: 'success' | 'pending' | 'failed' | 'cancelled';
  success?: boolean;
  finalizationOutcome?: string;
};

export function normalizeCurrencyCode(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  return normalized || undefined;
}

export function isVerificationResponse(
  value: unknown
): value is VerificationResponse {
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
  const hasValidCode =
    candidate.code === undefined || typeof candidate.code === 'string';

  return (
    hasValidStatus &&
    hasValidOrderNumber &&
    hasValidOrderId &&
    hasValidPaymentMethod &&
    hasValidSuccess &&
    hasValidFinalizationOutcome &&
    hasValidCode
  );
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

const RECONCILING_LOOKUP_PAYMENT_STATUSES = new Set(['cancelled', 'refunded']);

export interface VerifyCheckoutPaymentLookupParams {
  merchantSlug: string | undefined;
  orderId: string | null;
  paymentMethod: string | null;
  pendingRedvaultOrder: boolean;
  trackingToken: string | null;
  signal?: AbortSignal;
}

export interface VerifyCheckoutPaymentLookupHandlers {
  clearCart: () => void;
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
}

/**
 * No-reference pass: resolves the order by ID instead of verifying a
 * gateway reference. Returns false when no order identity exists and the
 * caller should redirect back to checkout. Extracted from
 * verify-checkout-payment.ts (300-line file limit).
 */
export async function verifyCheckoutPaymentByLookup(
  {
    merchantSlug,
    orderId,
    paymentMethod,
    pendingRedvaultOrder,
    trackingToken,
    signal,
  }: VerifyCheckoutPaymentLookupParams,
  {
    clearCart,
    scheduleFailedRedirect,
    setIsVerifying,
    setOrderNumber,
    setPaymentMethod,
    setStatus,
    capturePaymentCompleted,
  }: VerifyCheckoutPaymentLookupHandlers
): Promise<boolean> {
  if (!orderId) {
    return false;
  }

  setIsVerifying(true);
  try {
    const query = new URLSearchParams();
    if (merchantSlug) query.set('merchant_slug', merchantSlug);
    if (trackingToken) query.set('tracking_token', trackingToken);
    const queryString = query.toString();
    const url = `/api/storefront/orders/${encodeURIComponent(orderId)}${
      queryString ? `?${queryString}` : ''
    }`;
    const response = await fetch(url, { signal });
    const data = response.ok ? await response.json() : null;
    // Terminal states first: a fully refunded REDVAULT order keeps a
    // non-paid payment status, and a cancelled one can stay unpaid
    // with a cancelled shipping status. Neither is still processing.
    const redvaultTerminalCancelled =
      data?.payment_method === 'uba_redvault' &&
      data.payment_status !== 'paid' &&
      data.shipping_status === 'cancelled';
    const redvaultTerminalRefunded =
      data?.payment_method === 'uba_redvault' &&
      data.payment_status === 'refunded';
    if (
      data?.payment_method === 'uba_redvault' &&
      data.payment_status !== 'paid' &&
      data.payment_status !== 'refunded' &&
      !redvaultTerminalCancelled
    ) {
      setPaymentMethod('uba_redvault');
      setStatus('pending');
      setOrderNumber(
        data.order_number || data.short_id || orderId.slice(0, 8).toUpperCase()
      );
    } else if (redvaultTerminalCancelled) {
      setPaymentMethod('uba_redvault');
      setStatus('failed');
      scheduleFailedRedirect();
      setOrderNumber(
        data.order_number || data.short_id || orderId.slice(0, 8).toUpperCase()
      );
    } else if (redvaultTerminalRefunded) {
      // A fully refunded order is terminal non-success: never present
      // it as a payment success, and never clear the cart the shopper
      // may have built since.
      setPaymentMethod('uba_redvault');
      setStatus('failed');
      scheduleFailedRedirect();
      setOrderNumber(
        data.order_number || data.short_id || orderId.slice(0, 8).toUpperCase()
      );
    } else if (data && (data.order_number || data.short_id)) {
      const lookupPaymentStatus =
        typeof data.payment_status === 'string'
          ? data.payment_status.trim().toLowerCase()
          : '';
      if (RECONCILING_LOOKUP_PAYMENT_STATUSES.has(lookupPaymentStatus)) {
        // A cancelled/refunded order is terminal reconciliation, not a
        // confirmed purchase: the cart stays intact for a fresh attempt.
        setStatus('reconciling');
        setOrderNumber(data.order_number || data.short_id);
        if (data.payment_method) {
          setPaymentMethod(data.payment_method);
        }
        return true;
      }
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
          paymentMethod: data.payment_method || paymentMethod || 'paid_order',
          ...(Number.isFinite(lookupTotal) ? { total: lookupTotal } : {}),
          ...(lookupCurrency ? { currency: lookupCurrency } : {}),
        });
      }
    } else if (pendingRedvaultOrder) {
      // Fallback if API lookup fails: retain the REDVAULT cart instead of
      // confirming an order the lookup could not see.
      setPaymentMethod('uba_redvault');
      setStatus('pending');
      setOrderNumber(orderId.slice(0, 8).toUpperCase());
    } else {
      // Fallback if API lookup fails
      clearCart();
      setStatus('success');
      setOrderNumber(orderId.slice(0, 8).toUpperCase());
    }
  } catch (error) {
    // An aborted bound releases the lane for a retry; anything else
    // falls back to the derived order number.
    if (!isAbortError(error)) {
      console.error('Failed to fetch order details on success page:', error);
    }
    if (pendingRedvaultOrder) {
      setPaymentMethod('uba_redvault');
      setStatus('pending');
      setOrderNumber(orderId.slice(0, 8).toUpperCase());
    } else {
      clearCart();
      setStatus('success');
      setOrderNumber(orderId.slice(0, 8).toUpperCase());
    }
  } finally {
    setIsVerifying(false);
  }
  return true;
}
