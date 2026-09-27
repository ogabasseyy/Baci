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
  status?: 'success' | 'pending' | 'failed' | 'cancelled' | 'abandoned';
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
    candidate.status === 'cancelled' ||
    candidate.status === 'abandoned';
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

export interface VerifyCheckoutPaymentLookupParams {
  merchantSlug: string | undefined;
  orderId: string | null;
  paymentMethod: string | null;
  pendingRedvaultOrder: boolean;
  trackingToken: string | null;
  signal?: AbortSignal;
}

// Legacy rows carry both cancelled and canceled spellings for payment
// and shipping status (other eligibility paths accept both): normalize
// before either branch so a legacy cancellation can never present a
// false success or pend forever.
export function normalizeTerminalStatus(value: unknown): string {
  const normalized =
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'canceled' ? 'cancelled' : normalized;
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
